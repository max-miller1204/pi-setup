/**
 * Git Checkpoint Extension
 *
 * Fixed copy of the stock examples/extensions/git-checkpoint.ts (Pi 1.0.0).
 * The stock version clears its checkpoints when each run settles, and keys them by tool result.
 * A fork happens after a run settles and names a user message, so the stock version never restores.
 *
 * At the start of each run, this version records the working tree state for the user message.
 * The checkpoints are saved in the session, so they survive a restart.
 * When you fork, it offers to restore the code to the matching checkpoint:
 * - Fork before a message: the state when that message was sent.
 * - Fork at a message: the state when the next message was sent.
 *
 * Restoring never discards work. It first saves the current changes with `git stash push -u`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ENTRY_TYPE = "git-checkpoint";

interface Checkpoint {
	/** The user message entry that started the run. */
	entryId: string;
	/** HEAD when the run started. */
	head: string;
	/** A `git stash create` commit, or undefined when the working tree was clean. */
	stash: string | undefined;
}

export default function (pi: ExtensionAPI) {
	let checkpoints: Checkpoint[] = [];

	const git = async (args: string[]) => {
		const result = await pi.exec("git", args);
		if (result.code !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
		return result.stdout.trim();
	};

	pi.on("session_start", async (_event, ctx) => {
		checkpoints = [];
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === ENTRY_TYPE) checkpoints.push(entry.data as Checkpoint);
		}
	});

	// Pi saves a message entry after its message_end handlers run. So the snapshot is taken at the
	// user message_end, and the entry ID is attached at the next assistant message_end.
	// Tools run only after that assistant message, so the snapshot is from before any change.
	let pending: Omit<Checkpoint, "entryId"> | undefined;

	pi.on("message_end", async (event, ctx) => {
		if (event.message.role === "user") {
			const inRepo = await pi.exec("git", ["rev-parse", "--is-inside-work-tree"]);
			if (inRepo.code !== 0) return;
			const head = await git(["rev-parse", "HEAD"]);
			const stash = (await git(["stash", "create"])) || undefined;
			pending = { head, stash };
			return;
		}
		if (event.message.role !== "assistant" || !pending) return;
		const leaf = ctx.sessionManager.getLeafEntry();
		if (!leaf || leaf.type !== "message" || leaf.message.role !== "user") {
			throw new Error(`git-checkpoint: expected the user message entry before the answer, got ${leaf?.type}`);
		}
		const checkpoint: Checkpoint = { entryId: leaf.id, ...pending };
		pending = undefined;
		checkpoints.push(checkpoint);
		pi.appendEntry(ENTRY_TYPE, checkpoint);
	});

	pi.on("session_before_fork", async (event, ctx) => {
		const index = checkpoints.findIndex((c) => c.entryId === event.entryId);
		if (index === -1) return;
		const checkpoint = event.position === "before" ? checkpoints[index] : checkpoints[index + 1];
		if (!checkpoint) return;
		if (!ctx.hasUI) return;

		const head = await git(["rev-parse", "HEAD"]);
		if (head !== checkpoint.head) {
			ctx.ui.notify(
				`Cannot restore code: HEAD moved from ${checkpoint.head.slice(0, 8)} to ${head.slice(0, 8)} since that checkpoint.`,
				"error",
			);
			return;
		}

		const choice = await ctx.ui.select("Restore code state?", [
			"Yes, restore code to that point",
			"No, keep current code",
		]);
		if (!choice?.startsWith("Yes")) return;

		// Save the current changes first, so the restore loses nothing.
		const dirty = (await git(["status", "--porcelain"])) !== "";
		if (dirty) await git(["stash", "push", "-u", "-m", `pi git-checkpoint: before restore to ${event.entryId}`]);
		if (checkpoint.stash) await git(["stash", "apply", checkpoint.stash]);
		ctx.ui.notify(
			`Code restored to checkpoint.${dirty ? " Your previous changes are in `git stash list`." : ""}`,
			"info",
		);
	});
}
