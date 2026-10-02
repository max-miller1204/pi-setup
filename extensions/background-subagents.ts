/**
 * Background subagents.
 *
 * Port of pi-durable test/examples/23-subagent-background.ts.
 *
 * The `background_subagent` tool lets the main agent:
 * - spawn: start a named subagent with a first message.
 * - send: send another message. A busy subagent gets it as a steer,
 *   or after its current answer when followUp is true.
 * - stop: abort the current work of a subagent. The subagent stays usable.
 * - status: show which subagents are working or idle.
 *
 * Each subagent is a separate `pi --mode rpc` process with its own transcript.
 * Subagents keep working while the main agent answers the user.
 * Each answer comes back to the main agent as a new message.
 *
 * Difference from pi-durable: the subagents do not survive a restart of pi.
 * When the session ends, all subagent processes stop.
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { StringEnum } from "@earendil-works/pi-ai";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

/** Set in each subagent process, so subagents cannot start subagents. */
const CHILD_ENV = "PI_BACKGROUND_SUBAGENT";

interface Subagent {
	name: string;
	proc: ChildProcessWithoutNullStreams;
	busy: boolean;
	/** Set by stop: the next settled run was aborted and has nothing to report. */
	stopping: boolean;
	lastAnswer: AssistantMessage | undefined;
	/** Dialogs the subagent tried to open. Nobody can answer them, so they are cancelled. */
	cancelledDialogs: string[];
	pending: Map<string, { resolve: (data: unknown) => void; reject: (error: Error) => void }>;
	/** Called at the next agent_settled. */
	onSettled: Array<() => void>;
	nextId: number;
	stderr: string;
}

const textOf = (message: AssistantMessage) =>
	message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");

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

export default function (pi: ExtensionAPI) {
	if (process.env[CHILD_ENV] !== undefined) return;

	const agents = new Map<string, Subagent>();

	/** Give a message to the main agent. It starts a turn when idle, or waits for the current answer. */
	const report = (ctx: ExtensionContext, text: string) => {
		pi.sendUserMessage(text, ctx.isIdle() ? undefined : { deliverAs: "followUp" });
	};

	const command = (agent: Subagent, body: Record<string, unknown>): Promise<unknown> => {
		const id = `${agent.name}-${agent.nextId++}`;
		return new Promise((resolve, reject) => {
			agent.pending.set(id, { resolve, reject });
			agent.proc.stdin.write(`${JSON.stringify({ id, ...body })}\n`);
		});
	};

	const onRecord = (agent: Subagent, record: any, ctx: ExtensionContext) => {
		if (record.type === "response") {
			const waiter = agent.pending.get(record.id);
			if (!waiter) throw new Error(`subagent ${agent.name}: response for unknown id ${record.id}`);
			agent.pending.delete(record.id);
			if (record.success) waiter.resolve(record.data);
			else waiter.reject(new Error(`subagent ${agent.name}: ${record.command} failed: ${record.error}`));
			return;
		}
		if (record.type === "extension_ui_request") {
			if (["select", "confirm", "input", "editor"].includes(record.method)) {
				agent.cancelledDialogs.push(`${record.method}: ${record.title ?? ""}`);
				agent.proc.stdin.write(`${JSON.stringify({ type: "extension_ui_response", id: record.id, cancelled: true })}\n`);
			}
			return;
		}
		if (record.type === "agent_start") {
			agent.busy = true;
			agent.lastAnswer = undefined;
			return;
		}
		if (record.type === "message_end" && record.message?.role === "assistant") {
			agent.lastAnswer = record.message;
			return;
		}
		if (record.type === "agent_settled") {
			agent.busy = false;
			for (const resolve of agent.onSettled.splice(0)) resolve();
			const stopped = agent.stopping;
			agent.stopping = false;
			const dialogs = agent.cancelledDialogs.splice(0);
			const dialogNote =
				dialogs.length === 0 ? "" : `\n[subagent ${agent.name} tried to ask the user, which was cancelled: ${dialogs.join("; ")}]`;
			if (stopped) {
				if (dialogNote) report(ctx, dialogNote.trim());
				return;
			}
			const answer = agent.lastAnswer;
			if (!answer) {
				report(ctx, `[subagent ${agent.name} failed: it settled without an answer]${dialogNote}`);
			} else if (answer.stopReason === "error") {
				report(ctx, `[subagent ${agent.name} failed: ${answer.errorMessage}]${dialogNote}`);
			} else {
				report(ctx, `[subagent ${agent.name} answered, no reply needed] ${textOf(answer)}${dialogNote}`);
			}
		}
	};

	const start = (name: string, ctx: ExtensionContext): Subagent => {
		if (!ctx.model) throw new Error("No model is selected, so a subagent cannot copy it.");
		const args = [
			"--mode", "rpc", "--no-session",
			"--model", `${ctx.model.provider}/${ctx.model.id}`,
			"--thinking", pi.getThinkingLevel(),
			"--append-system-prompt", `You are the subagent "${name}". Answer the main agent's requests.`,
		];
		const invocation = piInvocation(args);
		const proc = spawn(invocation.command, invocation.args, {
			cwd: ctx.cwd,
			env: { ...process.env, [CHILD_ENV]: name },
			stdio: ["pipe", "pipe", "pipe"],
		});
		const agent: Subagent = {
			name,
			proc,
			busy: false,
			stopping: false,
			lastAnswer: undefined,
			cancelledDialogs: [],
			pending: new Map(),
			onSettled: [],
			nextId: 1,
			stderr: "",
		};

		// Strict JSONL: split only on LF (not with readline, which also splits on U+2028).
		let buffer = "";
		proc.stdout.on("data", (data) => {
			buffer += data.toString();
			let newline = buffer.indexOf("\n");
			while (newline !== -1) {
				const line = buffer.slice(0, newline).replace(/\r$/, "");
				buffer = buffer.slice(newline + 1);
				if (line.trim()) onRecord(agent, JSON.parse(line), ctx);
				newline = buffer.indexOf("\n");
			}
		});
		proc.stderr.on("data", (data) => {
			agent.stderr = (agent.stderr + data.toString()).slice(-4000);
		});
		proc.on("exit", (code, sig) => {
			if (agents.get(name) !== agent) return;
			agents.delete(name);
			const error = new Error(`subagent ${name} exited (code ${code}, signal ${sig})`);
			for (const waiter of agent.pending.values()) waiter.reject(error);
			for (const resolve of agent.onSettled.splice(0)) resolve();
			report(ctx, `[subagent ${name} exited unexpectedly: code ${code}, signal ${sig}]\n${agent.stderr.trim()}`);
			ctx.ui.notify(`Subagent ${name} exited unexpectedly`, "error");
		});
		agents.set(name, agent);
		return agent;
	};

	const deliver = async (agent: Subagent, message: string, followUp: boolean) => {
		if (!agent.busy) {
			// Mark busy now: agent_start comes later, and a second send must not start a parallel prompt.
			agent.busy = true;
			await command(agent, { type: "prompt", message });
		} else {
			await command(agent, { type: followUp ? "follow_up" : "steer", message });
		}
	};

	pi.registerTool({
		name: "background_subagent",
		label: "Background Subagent",
		// The calls share the subagent map, so sibling calls run one at a time.
		executionMode: "sequential",
		description:
			"Manage persistent subagents that work in the background. Actions: spawn (name, message), send (name, message; " +
			"followUp: true queues it after the current answer instead of steering), stop (name: aborts its current work), " +
			"status (name, or all subagents without one). Answers are reported back to you when they arrive.",
		parameters: Type.Object({
			action: StringEnum(["spawn", "send", "stop", "status"] as const),
			name: Type.Optional(Type.String()),
			message: Type.Optional(Type.String()),
			followUp: Type.Optional(Type.Boolean()),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const { action, name, message, followUp } = params;
			const reply = (text: string) => ({ content: [{ type: "text" as const, text }], details: undefined });

			if (action === "status") {
				const list = name === undefined ? [...agents.values()] : [agents.get(name)].filter((a) => a !== undefined);
				if (name !== undefined && list.length === 0) throw new Error(`No subagent named ${name}.`);
				if (list.length === 0) return reply("No subagents.");
				return reply(list.map((a) => `${a.name}: ${a.busy ? "working" : "idle"}`).join("\n"));
			}
			if (name === undefined) throw new Error(`${action} needs a name.`);

			if (action === "spawn") {
				if (agents.has(name)) throw new Error(`${name} already exists; use send.`);
				if (message === undefined) throw new Error("spawn needs a message.");
				await deliver(start(name, ctx), message, false);
				return reply(`Started ${name}.`);
			}

			const agent = agents.get(name);
			if (!agent) throw new Error(`No subagent named ${name}.`);

			if (action === "stop") {
				if (!agent.busy) return reply(`${name} is idle; nothing to stop.`);
				agent.stopping = true;
				const settled = new Promise<void>((resolve) => agent.onSettled.push(resolve));
				await command(agent, { type: "clear_queue" });
				await command(agent, { type: "abort" });
				await settled;
				return reply(`Stopped ${name}.`);
			}

			if (message === undefined) throw new Error("send needs a message.");
			await deliver(agent, message, followUp === true);
			return reply(`Sent to ${name}.`);
		},
	});

	pi.on("session_shutdown", async () => {
		for (const agent of agents.values()) agent.proc.stdin.end();
		agents.clear();
	});
}
