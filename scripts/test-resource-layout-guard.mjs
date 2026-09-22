import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "pi-layout-guard-"));
try {
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  for (const pi of [
    { extensions: ["./extensions/**/*.ts"], skills: [] },
    { extensions: ["./extensions/*.ts"], skills: ["./skills/*"] },
  ]) {
    const fixture = path.join(temp, "package.json");
    await writeFile(fixture, JSON.stringify({ ...manifest, pi }));
    assert.throws(() => execFileSync(process.execPath, ["scripts/test-resource-layout.mjs", fixture], {
      cwd: root, encoding: "utf8", stdio: "pipe",
    }), (error) => error.status !== 0 && /AssertionError/.test(error.stderr));
  }
  console.log("Resource manifest guard rejects unexpected discovery patterns.");
} finally {
  await rm(temp, { recursive: true, force: true });
}
