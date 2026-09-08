import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const root = process.cwd();
const configDir = await mkdtemp(path.join(os.tmpdir(), "pi-setup-ci-"));
const piBin = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "pi.cmd" : "pi");
const args = [
  "--mode", "rpc",
  "--no-session",
  "--no-context-files",
  "--no-skills",
  "--no-prompt-templates",
  "--no-extensions",
  "--tools", "ask_user_question,read_only_git",
  "-e", path.join(root, "extensions", "ask-user-question.ts"),
  "-e", path.join(root, "extensions", "custom-header.ts"),
  "-e", path.join(root, "extensions", "read-only-git.ts"),
];

try {
  const child = spawn(piBin, args, {
    cwd: root,
    env: { ...process.env, PI_CODING_AGENT_DIR: configDir, PI_OFFLINE: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });

  child.stdin.end(`${JSON.stringify({ id: "ci", type: "get_commands" })}\n`);

  const exitCode = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Pi RPC smoke test timed out"));
    }, 20_000);
    child.once("error", reject);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });

  assert.equal(exitCode, 0, `Pi RPC exited with ${exitCode}: ${stderr}`);
  const events = stdout.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(events.some((event) => event.type === "extension_error"), false, stdout);

  const response = events.find((event) => event.type === "response" && event.id === "ci");
  assert.ok(response, `Missing RPC response:\n${stdout}`);
  assert.equal(response.success, true, JSON.stringify(response));
  assert.ok(
    response.data.commands.some((command) => command.name === "builtin-header"),
    `custom-header command was not registered:\n${stdout}`,
  );

  console.log("Extension smoke test passed: Pi loaded all three extensions and registered builtin-header.");
} finally {
  await rm(configDir, { recursive: true, force: true });
}
