/**
 * Reviewer with a review loop.
 *
 * Port of pi-durable test/examples/28-reviewer.ts.
 *
 * The `review` tool and the `/review` command start a separate reviewer agent:
 * - It uses a cheaper model (REVIEWER_MODEL).
 * - It has read-only tools: read, grep, find, ls.
 * - It gets a review role that tells it never to edit files.
 * - It runs a review loop. If an answer does not say DONE, the reviewer must look again.
 *   The loop stops after MAX_PASSES passes.
 *
 * The reviewer reviews `git diff <base>` and the untracked files in the current repository.
 *
 * The same file runs inside the reviewer process. There, PI_REVIEWER_LOOP=1 turns on the loop.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const REVIEWER_MODEL = "openai-codex/gpt-6-luna";
const REVIEWER_THINKING = "low";
const REVIEWER_TOOLS = "read,grep,find,ls";
const MAX_PASSES = 4;
const DONE = "No further findings.";
const LOOP_ENV = "PI_REVIEWER_LOOP";
const ROLE = `You review diffs. Report problems as a numbered list with file and line. Never edit files. When there is nothing left to report, end your answer with "${DONE}"`;

const textOf = (message: AssistantMessage) =>
	message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");

function git(cwd: string, args: string[]): string {
	const result = spawnSync("git", args, { cwd, encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 });
	if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
	return result.stdout;
}

/** Find how to start pi again, the same way the stock subagent extension does. */
function piInvocation(args: string[]): { command: string; args: string[] } {
	const script = process.argv[1];
	if (script && !script.startsWith("/$bunfs/root/") && existsSync(script)) {
		return { command: process.execPath, args: [script, ...args] };
	}
	if (!/^(node|bun)(\.exe)?$/.test(basename(process.execPath).toLowerCase())) {
		return { command: process.execPath, args };
	}
	return { command: "pi", args };
}

// ─── Reviewer process: the review loop ──────────────────────────────────────

function installLoop(pi: ExtensionAPI) {
	let passes = 1;
	pi.on("agent_before_settle", async (event) => {
		if (event.outcome !== "completed") return;
		const last = [...event.context.contextMessages]
			.reverse()
			.find((message): message is AssistantMessage => (message as Message).role === "assistant");
		if (!last) throw new Error("reviewer loop: no assistant answer to check");
		if (textOf(last).includes(DONE)) return;
		if (passes >= MAX_PASSES) return;
		passes++;
		return {
			entries: [
				{
					type: "custom_message",
					customType: "reviewer-loop",
					content: `Look again for anything you missed. Say "${DONE}" when there is nothing left.`,
					display: true,
				},
			],
			continue: true,
		};
	});
}

// ─── Main process: the review tool ──────────────────────────────────────────

interface ReviewDetails {
	model: string;
	passes: number;
	finished: boolean;
	cost: number;
}

async function runReview(
	cwd: string,
	base: string,
	focus: string | undefined,
	signal: AbortSignal | undefined,
): Promise<{ text: string; details: ReviewDetails }> {
	git(cwd, ["rev-parse", "--is-inside-work-tree"]);
	const diff = git(cwd, ["diff", base]);
	const untracked = git(cwd, ["ls-files", "--others", "--exclude-standard"]).trim();
	if (diff.trim() === "" && untracked === "") throw new Error(`Nothing to review: no diff against ${base} and no untracked files.`);

	// The diff goes in a file, because a large diff does not fit in a command-line argument.
	const tmp = mkdtempSync(join(tmpdir(), "pi-review-"));
	const diffPath = join(tmp, "review.diff");
	writeFileSync(diffPath, diff, { mode: 0o600 });

	const task = [
		`Review the changes in ${cwd}.`,
		diff.trim() === "" ? "There is no diff." : `The diff against ${base} is in ${diffPath}. Read it first.`,
		untracked === "" ? "" : `These new files are not in the diff. Read them too:\n${untracked}`,
		focus ? `Focus: ${focus}` : "",
	]
		.filter(Boolean)
		.join("\n\n");

	const args = [
		"--mode", "json", "-p", "--no-session",
		"--no-extensions", "-e", fileURLToPath(import.meta.url),
		"--tools", REVIEWER_TOOLS,
		"--model", REVIEWER_MODEL,
		"--thinking", REVIEWER_THINKING,
		"--append-system-prompt", ROLE,
		task,
	];

	const answers: AssistantMessage[] = [];
	// The final answer text of each pass.
	const passTexts: string[] = [];
	let stderr = "";
	try {
		const exitCode = await new Promise<number>((resolve, reject) => {
			const invocation = piInvocation(args);
			const proc = spawn(invocation.command, invocation.args, {
				cwd,
				env: { ...process.env, [LOOP_ENV]: "1" },
				stdio: ["ignore", "pipe", "pipe"],
			});
			let buffer = "";
			const onLine = (line: string) => {
				if (!line.trim()) return;
				const event = JSON.parse(line);
				if (event.type !== "message_end" || event.message?.role !== "assistant") return;
				answers.push(event.message);
				// A turn that calls tools is not the end of a pass.
				if (event.message.stopReason !== "toolUse") passTexts.push(textOf(event.message));
			};
			proc.stdout.on("data", (data) => {
				buffer += data.toString();
				const lines = buffer.split("\n");
				buffer = lines.pop() ?? "";
				for (const line of lines) onLine(line);
			});
			proc.stderr.on("data", (data) => {
				stderr += data.toString();
			});
			proc.on("error", reject);
			proc.on("close", (code) => {
				onLine(buffer);
				resolve(code ?? 1);
			});
			signal?.addEventListener("abort", () => proc.kill("SIGTERM"), { once: true });
		});
		if (signal?.aborted) throw new Error("Review aborted.");
		if (exitCode !== 0) throw new Error(`Reviewer exited with code ${exitCode}.\n${stderr.trim()}`);
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}

	const last = answers.at(-1);
	if (!last) throw new Error(`Reviewer gave no answer.\n${stderr.trim()}`);
	if (last.stopReason === "error") throw new Error(`Reviewer failed: ${last.errorMessage}`);

	return {
		text: passTexts.map((text, i) => `Pass ${i + 1}:\n${text}`).join("\n\n"),
		details: {
			model: REVIEWER_MODEL,
			passes: passTexts.length,
			finished: textOf(last).includes(DONE),
			cost: answers.reduce((sum, message) => sum + (message.usage?.cost?.total ?? 0), 0),
		},
	};
}

export default function (pi: ExtensionAPI) {
	if (process.env[LOOP_ENV] === "1") {
		installLoop(pi);
		return;
	}

	pi.registerTool({
		name: "review",
		label: "Review",
		description:
			"Start a separate read-only reviewer agent on the uncommitted changes in this repository. " +
			"It reviews the diff against a base ref, plus untracked files, and returns its findings.",
		parameters: Type.Object({
			base: Type.Optional(Type.String({ description: 'Git ref to diff against. Default: "HEAD".' })),
			focus: Type.Optional(Type.String({ description: "What the reviewer should pay most attention to." })),
		}),
		async execute(_id, params, signal, onUpdate, ctx) {
			onUpdate?.({ content: [{ type: "text", text: `Reviewing with ${REVIEWER_MODEL}...` }], details: undefined });
			const { text, details } = await runReview(ctx.cwd, params.base ?? "HEAD", params.focus, signal);
			const footer = details.finished
				? `Reviewer finished after ${details.passes} passes.`
				: `WARNING: the reviewer did not say "${DONE}" after ${MAX_PASSES} passes. The review may be incomplete.`;
			return {
				content: [{ type: "text", text: `${text}\n\n${footer}` }],
				details,
				isError: !details.finished,
			};
		},
	});

	pi.registerCommand("review", {
		description: "Review the uncommitted changes with a separate reviewer agent. Optional: a focus",
		handler: async (args) => {
			const focus = args.trim();
			pi.sendUserMessage(`Use the review tool${focus ? ` with focus "${focus}"` : ""}, then summarize its findings.`);
		},
	});
}
