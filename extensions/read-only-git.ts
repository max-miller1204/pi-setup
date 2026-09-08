import { spawn } from "node:child_process";
import { delimiter, isAbsolute } from "node:path";
import process from "node:process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";

const MAX_SLICE_BYTES = 50 * 1024;
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const GIT_TIMEOUT_MS = 10_000;
const FULL_SHA = /^(?:[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/;
const SAFE_PATH_PART = /^[^\0\r\n:]+$/;

const ReadOnlyGitParams = Type.Object(
	{
		operation: Type.String({
			enum: ["resolve", "diff", "show", "files", "log"],
			description: "Inspection operation to run.",
		}),
		commit: Type.Optional(
			Type.String({ description: 'A full 40- or 64-character commit SHA, or the literal "HEAD".' }),
		),
		base: Type.Optional(Type.String({ description: "The full base commit SHA, or HEAD." })),
		head: Type.Optional(Type.String({ description: "The full head commit SHA, or HEAD." })),
		mode: Type.Optional(
			Type.String({ enum: ["patch", "names"], description: "Diff output format. Defaults to patch." }),
		),
		path: Type.Optional(Type.String({ description: "Repository-relative path for show." })),
		maxCount: Type.Optional(
			Type.Integer({ minimum: 1, maximum: 100, description: "Maximum log entries. Defaults to 20." }),
		),
		offset: Type.Optional(
			Type.Integer({ minimum: 0, maximum: MAX_GIT_OUTPUT_BYTES, description: "Output byte offset." }),
		),
		limit: Type.Optional(
			Type.Integer({ minimum: 4, maximum: MAX_SLICE_BYTES, description: "Output byte limit. Defaults to 50 KiB." }),
		),
	},
	{ additionalProperties: false },
);

export type ReadOnlyGitInput = Static<typeof ReadOnlyGitParams>;

interface GitResult {
	stdout: Buffer;
	stderr: Buffer;
	code: number | null;
	totalBytes: number;
	stderrTruncated: boolean;
}

function abortError(signal: AbortSignal): Error {
	if (signal.reason instanceof Error) return signal.reason;
	const error = new Error("Git inspection was cancelled.");
	error.name = "AbortError";
	return error;
}

function validateCommit(value: unknown, field: string): string {
	if (typeof value !== "string" || (value !== "HEAD" && !FULL_SHA.test(value))) {
		throw new Error(`${field} must be HEAD or a full 40- or 64-character commit SHA.`);
	}
	return value === "HEAD" ? value : value.toLowerCase();
}

function validatePath(value: unknown): string {
	if (typeof value !== "string" || value.length === 0 || value.length > 4096 || !SAFE_PATH_PART.test(value)) {
		throw new Error("path must be a non-empty repository-relative path without colons or control characters.");
	}
	if (value.startsWith("/") || value.split("/").some((part) => part === "" || part === "." || part === "..")) {
		throw new Error("path must stay inside the repository and use normalized relative components.");
	}
	return value;
}

function ownKeys(value: object): string[] {
	return Object.keys(value).sort();
}

function validateInput(raw: unknown): {
	operation: "resolve" | "diff" | "show" | "files" | "log";
	commit?: string;
	base?: string;
	head?: string;
	mode?: "patch" | "names";
	path?: string;
	maxCount?: number;
	offset: number;
	limit: number;
} {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Input must be an object.");
	const input = raw as Record<string, unknown>;
	const common = new Set(["operation", "offset", "limit"]);
	const allowedByOperation: Record<string, Set<string>> = {
		resolve: new Set([...common, "commit"]),
		diff: new Set([...common, "base", "head", "mode"]),
		show: new Set([...common, "commit", "path"]),
		files: new Set([...common, "commit"]),
		log: new Set([...common, "commit", "maxCount"]),
	};
	if (typeof input.operation !== "string" || !Object.hasOwn(allowedByOperation, input.operation)) {
		throw new Error("operation must be resolve, diff, show, files, or log.");
	}
	const operation = input.operation as keyof typeof allowedByOperation;
	const invalid = ownKeys(input).filter((key) => !allowedByOperation[operation].has(key));
	if (invalid.length > 0) throw new Error(`Unsupported field for ${operation}: ${invalid.join(", ")}.`);
	const offset = input.offset === undefined ? 0 : input.offset;
	const limit = input.limit === undefined ? MAX_SLICE_BYTES : input.limit;
	if (!Number.isInteger(offset) || (offset as number) < 0 || (offset as number) > MAX_GIT_OUTPUT_BYTES) {
		throw new Error(`offset must be an integer from 0 to ${MAX_GIT_OUTPUT_BYTES}.`);
	}
	if (!Number.isInteger(limit) || (limit as number) < 4 || (limit as number) > MAX_SLICE_BYTES) {
		throw new Error(`limit must be an integer from 4 to ${MAX_SLICE_BYTES}.`);
	}

	const result = { operation, offset: offset as number, limit: limit as number } as ReturnType<typeof validateInput>;
	if (operation === "resolve") result.commit = validateCommit(input.commit ?? "HEAD", "commit");
	if (operation === "diff") {
		result.base = validateCommit(input.base, "base");
		result.head = validateCommit(input.head ?? "HEAD", "head");
		if (input.mode !== undefined && input.mode !== "patch" && input.mode !== "names") {
			throw new Error("mode must be patch or names.");
		}
		result.mode = (input.mode as "patch" | "names" | undefined) ?? "patch";
	}
	if (operation === "show") {
		result.commit = validateCommit(input.commit, "commit");
		result.path = validatePath(input.path);
	}
	if (operation === "files") result.commit = validateCommit(input.commit, "commit");
	if (operation === "log") {
		result.commit = validateCommit(input.commit ?? "HEAD", "commit");
		const maxCount = input.maxCount ?? 20;
		if (!Number.isInteger(maxCount) || (maxCount as number) < 1 || (maxCount as number) > 100) {
			throw new Error("maxCount must be an integer from 1 to 100.");
		}
		result.maxCount = maxCount as number;
	}
	return result;
}

function gitEnvironment(): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = {
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
		GIT_NO_LAZY_FETCH: "1",
		GIT_OPTIONAL_LOCKS: "0",
		GIT_PAGER: "cat",
		GIT_TERMINAL_PROMPT: "0",
		LC_ALL: "C",
		PAGER: "cat",
		PATH: (process.env.PATH ?? "")
			.split(delimiter)
			.filter((entry) => entry.length > 0 && isAbsolute(entry))
			.join(delimiter),
	};
	if (process.platform === "win32") env.SystemRoot = process.env.SystemRoot;
	return env;
}

async function runGit(cwd: string, args: string[], offset: number, limit: number, signal?: AbortSignal): Promise<GitResult> {
	if (signal?.aborted) throw abortError(signal);
	const commonArgs = [
		"--no-pager",
		"--no-lazy-fetch",
		"--no-optional-locks",
		"--no-replace-objects",
		"-c", "core.fsmonitor=false",
		"-c", "core.quotePath=false",
		"-c", `core.hooksPath=${process.platform === "win32" ? "NUL" : "/dev/null"}`,
		"-c", "diff.external=",
		"-c", "fetch.recurseSubmodules=false",
		"-c", "submodule.recurse=false",
	];

	return await new Promise<GitResult>((resolve, reject) => {
		const child = spawn("git", [...commonArgs, ...args], {
			cwd,
			env: gitEnvironment(),
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		let settled = false;
		let totalBytes = 0;
		let stdoutBytes = 0;
		const captureLimit = limit + 3;
		let overflow = false;
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let stderrBytes = 0;
		let stderrTruncated = false;

		const finishReject = (error: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			reject(error);
		};
		const stop = () => child.kill("SIGKILL");
		const onAbort = () => {
			stop();
			finishReject(abortError(signal!));
		};
		const timer = setTimeout(() => {
			stop();
			finishReject(new Error(`Git inspection exceeded the ${GIT_TIMEOUT_MS} ms time limit.`));
		}, GIT_TIMEOUT_MS);
		signal?.addEventListener("abort", onAbort, { once: true });

		child.stdout.on("data", (chunk: Buffer) => {
			const start = totalBytes;
			totalBytes += chunk.length;
			if (totalBytes > MAX_GIT_OUTPUT_BYTES) {
				overflow = true;
				stop();
				return;
			}
			const from = Math.max(0, offset - start);
			const to = Math.min(chunk.length, offset + captureLimit - start);
			if (to > from && stdoutBytes < captureLimit) {
				const part = chunk.subarray(from, to);
				stdout.push(part);
				stdoutBytes += part.length;
			}
		});
		child.stderr.on("data", (chunk: Buffer) => {
			if (stderrBytes >= MAX_STDERR_BYTES) {
				stderrTruncated = true;
				return;
			}
			const part = chunk.subarray(0, MAX_STDERR_BYTES - stderrBytes);
			stderr.push(part);
			stderrBytes += part.length;
			if (part.length < chunk.length) stderrTruncated = true;
		});
		child.once("error", finishReject);
		child.once("close", (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			if (overflow) {
				reject(new Error(`Git output exceeded the ${MAX_GIT_OUTPUT_BYTES}-byte safety limit.`));
				return;
			}
			resolve({ stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), code, totalBytes, stderrTruncated });
		});
	});
}

function utf8Slice(buffer: Buffer, requestedOffset: number, limit: number): { content: Buffer; offset: number; endOffset: number } {
	let start = 0;
	while (start < buffer.length && (buffer[start]! & 0xc0) === 0x80) start += 1;
	const offset = requestedOffset + start;
	let end = Math.min(buffer.length, start + limit);
	let lead = end - 1;
	while (lead >= start && (buffer[lead]! & 0xc0) === 0x80) lead -= 1;
	if (lead < start) {
		end = start;
	} else {
		const first = buffer[lead]!;
		const width = first <= 0x7f ? 1 : first >= 0xc2 && first <= 0xdf ? 2 : first <= 0xef ? 3 : first <= 0xf4 ? 4 : 1;
		if (end - lead < width) end = lead;
	}
	return { content: buffer.subarray(start, end), offset, endOffset: requestedOffset + end };
}

function gitArguments(input: ReturnType<typeof validateInput>): string[] {
	switch (input.operation) {
		case "resolve":
			return ["rev-parse", "--verify", "--end-of-options", `${input.commit}^{commit}`];
		case "diff":
			return input.mode === "names"
				? ["diff", "--name-status", "--no-color", "--no-renames", "--ignore-submodules=none", "--submodule=short", "--no-ext-diff", "--no-textconv", input.base!, input.head!, "--"]
				: ["diff", "--patch", "--no-color", "--no-renames", "--ignore-submodules=none", "--submodule=short", "--no-ext-diff", "--no-textconv", input.base!, input.head!, "--"];
		case "show":
			return ["show", "--no-color", "--no-ext-diff", "--no-textconv", "--format=", `${input.commit}:${input.path}`];
		case "files":
			return ["ls-tree", "--full-tree", "-r", "--name-only", input.commit!, "--"];
		case "log":
			return ["log", "--no-color", "--no-decorate", "--no-show-signature", `--max-count=${input.maxCount}`, "--format=%H%x09%aI%x09%an%x09%s", input.commit!, "--"];
	}
}

export default function readOnlyGitExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "read_only_git",
		label: "Read-only Git",
		description: `Inspect committed repository evidence at the current working directory. Supports commit resolution, commit-to-commit diff, committed file content, committed file listing, and log. Revisions must be HEAD or full 40- or 64-character commit SHAs. Output uses UTF-8-safe byte slices and is limited to ${MAX_SLICE_BYTES} bytes per call and ${MAX_GIT_OUTPUT_BYTES} bytes total. Each Git process has a ${GIT_TIMEOUT_MS} ms time limit. The trusted host supplies the Git executable and this extension. This tool is not an operating-system sandbox.`,
		parameters: ReadOnlyGitParams,
		async execute(_toolCallId, rawParams, signal, _onUpdate, ctx) {
			const input = validateInput(rawParams);
			const result = await runGit(ctx.cwd, gitArguments(input), input.offset, input.limit, signal);
			if (result.code !== 0) {
				let message = result.stderr.toString("utf8").trim() || `git exited with code ${String(result.code)}`;
				if (result.stderrTruncated) message += ` [stderr truncated at ${MAX_STDERR_BYTES} bytes]`;
				throw new Error(`Git ${input.operation} failed: ${message}`);
			}
			if (input.offset > result.totalBytes) {
				throw new Error(`offset ${input.offset} exceeds the ${result.totalBytes}-byte Git output.`);
			}
			const slice = utf8Slice(result.stdout, input.offset, input.limit);
			if (slice.endOffset === slice.offset && slice.endOffset < result.totalBytes) {
				throw new Error("limit cannot contain one complete UTF-8 character at this offset.");
			}
			const truncated = slice.offset > 0 || slice.endOffset < result.totalBytes;
			let text = slice.content.toString("utf8");
			if (truncated) {
				text += `\n[Byte slice ${slice.offset}:${slice.endOffset} of ${result.totalBytes}. Request another offset to continue.]`;
			}
			return {
				content: [{ type: "text" as const, text }],
				details: {
					operation: input.operation,
					requestedOffset: input.offset,
					offset: slice.offset,
					endOffset: slice.endOffset,
					totalBytes: result.totalBytes,
					truncated,
					nextOffset: slice.endOffset < result.totalBytes ? slice.endOffset : undefined,
				},
			};
		},
	});
}
