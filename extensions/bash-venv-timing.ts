/**
 * Bash virtualenv and timing.
 *
 * Port of pi-durable test/examples/30-tool-override.ts.
 *
 * - Replaces `bash` with a version that can run inside `.venv`.
 *   Use `/venv` to turn this on or off for the current session.
 *   The setting is saved in the session, so a resumed session keeps it.
 * - Times every `bash` call, whichever `bash` tool is active.
 *   Use `/bash-timings` to show the timings for this session.
 *
 * If venv mode is on and `.venv/bin/activate` does not exist, the call fails.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createBashTool, createBashToolDefinition } from "@earendil-works/pi-coding-agent";

const ENTRY_TYPE = "bash-venv";
const ACTIVATE = ".venv/bin/activate";

interface Timing {
	command: string;
	ms: number;
	isError: boolean;
}

export default function (pi: ExtensionAPI) {
	let venv = false;
	const started = new Map<string, { command: string; at: number }>();
	const timings: Timing[] = [];

	const updateStatus = (ctx: ExtensionContext) => {
		const last = timings.at(-1);
		const parts: string[] = [];
		if (venv) parts.push("venv");
		if (last) parts.push(`bash ${timings.length}x, last ${last.ms}ms`);
		ctx.ui.setStatus("bash-venv-timing", parts.length > 0 ? parts.join(" | ") : undefined);
	};

	// The tool is created for each call, so it always uses the current cwd and venv setting.
	const template = createBashToolDefinition(process.cwd());
	pi.registerTool({
		...template,
		async execute(id, params, signal, onUpdate, ctx) {
			const useVenv = venv;
			if (useVenv && !existsSync(join(ctx.cwd, ACTIVATE))) {
				throw new Error(`venv mode is on, but ${join(ctx.cwd, ACTIVATE)} does not exist. Run /venv to turn it off.`);
			}
			const bash = createBashTool(ctx.cwd, {
				spawnHook: ({ command, cwd, env }) => ({
					command: useVenv ? `source ${ACTIVATE}\n${command}` : command,
					cwd,
					env,
				}),
			});
			return bash.execute(id, params, signal, onUpdate);
		},
	});

	// Timing uses events, so it also measures a bash tool from another extension.
	pi.on("tool_call", async (event) => {
		if (event.toolName !== "bash") return;
		started.set(event.toolCallId, { command: String(event.input.command), at: Date.now() });
	});

	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "bash") return;
		const start = started.get(event.toolCallId);
		if (!start) throw new Error(`bash-venv-timing: no start time for tool call ${event.toolCallId}`);
		started.delete(event.toolCallId);
		timings.push({ command: start.command, ms: Date.now() - start.at, isError: event.isError });
		updateStatus(ctx);
	});

	pi.registerCommand("venv", {
		description: `Turn running bash inside ${ACTIVATE} on or off for this session`,
		handler: async (_args, ctx) => {
			if (!venv && !existsSync(join(ctx.cwd, ACTIVATE))) {
				ctx.ui.notify(`Cannot turn on venv mode: ${join(ctx.cwd, ACTIVATE)} does not exist.`, "error");
				return;
			}
			venv = !venv;
			pi.appendEntry(ENTRY_TYPE, { enabled: venv });
			ctx.ui.notify(`venv mode ${venv ? "on" : "off"}`, "info");
			updateStatus(ctx);
		},
	});

	pi.registerCommand("bash-timings", {
		description: "Show how long each bash call took in this session",
		handler: async (_args, ctx) => {
			if (timings.length === 0) {
				ctx.ui.notify("No bash calls yet.", "info");
				return;
			}
			const total = timings.reduce((sum, t) => sum + t.ms, 0);
			const lines = timings.map(
				(t, i) => `${i + 1}. ${t.ms}ms${t.isError ? " (error)" : ""}  ${t.command.split("\n")[0].slice(0, 80)}`,
			);
			ctx.ui.notify(`${lines.join("\n")}\nTotal: ${total}ms in ${timings.length} calls`, "info");
		},
	});

	// Restore the venv setting from the session branch.
	pi.on("session_start", async (_event, ctx) => {
		venv = false;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === ENTRY_TYPE) {
				venv = (entry.data as { enabled: boolean }).enabled;
			}
		}
		updateStatus(ctx);
	});
}
