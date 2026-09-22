import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const checker = path.join(process.cwd(), "scripts", "check-dependencies.mjs");
const fixture = await mkdtemp(path.join(os.tmpdir(), "pi-dependency-guard-"));
const legacyPiScope = "@mariozechner";
const legacyTypeboxScope = "@sinclair";

try {
  await mkdir(path.join(fixture, "extensions"));
  await writeFile(path.join(fixture, "package.json"), JSON.stringify({
    dependencies: {
      [`${legacyPiScope}/pi-coding-agent`]: "*",
      [`${legacyTypeboxScope}/typebox`]: "*",
    },
  }));
  await writeFile(path.join(fixture, "package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages: {} }));
  await writeFile(
    path.join(fixture, "extensions", "legacy.ts"),
    [
      `import type { ExtensionAPI } from "${legacyPiScope}/pi-coding-agent";`,
      `import { Text } from "${legacyPiScope}/pi-tui";`,
      `import { Type } from "${legacyTypeboxScope}/typebox";`,
    ].join("\n"),
  );

  const result = spawnSync(process.execPath, [checker], { cwd: fixture, encoding: "utf8" });
  assert.notEqual(result.status, 0, "dependency guard accepted legacy Pi packages");
  assert.match(result.stderr, /Pi dependency validation failed/);
  assert.match(result.stderr, /must pin @earendil-works\/pi-coding-agent@0\.87\.0/);
  assert.match(result.stderr, /pi-coding-agent/);
  assert.match(result.stderr, /pi-tui/);
  assert.match(result.stderr, /typebox/);

  console.log("Dependency guard regression test passed: legacy imports and dependencies were rejected.");
} finally {
  await rm(fixture, { recursive: true, force: true });
}
