import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const manifestPath = process.argv[2] ?? path.join(root, "package.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
assert.deepEqual(manifest.pi?.extensions, ["./extensions/*.ts"], "Pi must load only active extensions");
assert.deepEqual(manifest.pi?.skills, [], "Pi must not load bundled skills");
const names = async (dir) => (await readdir(path.join(root, dir))).filter((name) => !name.startsWith(".")).sort();

assert.deepEqual(await names("agents"), ["browser-worker.md", "researcher.md", "scout.md", "worker.md"]);
assert.deepEqual(await names("extensions"), ["ask-user-question.ts", "custom-header.ts"]);
assert.deepEqual(await names("skills"), []);
for (const relative of [
  "dormant/agents/review-pass.md",
  "dormant/agents/reviewer.md",
  "dormant/extensions/read-only-git.ts",
  "dormant/skills/iterative-review/SKILL.md",
  "dormant/skills/reviewed-pr/SKILL.md",
  "dormant/tests/test-read-only-git.mjs",
]) await access(path.join(root, relative));

console.log("Resource layout passed: active and dormant resources are separated.");
