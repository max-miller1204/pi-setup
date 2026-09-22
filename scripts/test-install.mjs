import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "pi-setup-install-"));
const template = JSON.parse(await readFile(path.join(root, "config/settings.json"), "utf8"));
const expectedPackages = [
  "npm:pi-web-access",
  "git:github.com/max-miller1204/pi-observational-memory",
  "npm:pi-mcp-adapter",
  "git:github.com/max-miller1204/pi-interactive-subagents",
  "git:github.com/max-miller1204/pi-setup",
  "git:github.com/obra/superpowers",
  "git:github.com/max-miller1204/pi-session-tasks",
];
const ownedSkills = [];
const externalSkills = ["mcp-scripting", "playwright-cli", "superpowers", "unrelated-skill"];
try {
  assert.deepEqual(template.packages, expectedPackages);
  assert.equal(template.externalEditor, "nvim");
  const bin = path.join(temp, "bin");
  await mkdir(bin);
  // Record package requests without network access or changes to the active Pi setup.
  await writeFile(path.join(bin, "pi"), `#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path
assert sys.argv[1] in ("install", "remove")
assert len(sys.argv) == 3
settings = Path(os.environ["PI_CODING_AGENT_DIR"]) / "settings.json"
current = json.loads(settings.read_text()) if settings.exists() else {}
packages = current.setdefault("packages", [])
source = sys.argv[2]
if sys.argv[1] == "install" and source not in packages:
    packages.append(source)
if sys.argv[1] == "remove":
    assert source in ("npm:stepstone", "git:github.com/elpapi42/pi-observational-memory"), f"Unexpected removal: {source}"
    assert source in packages, f"Already removed: {source}"
    packages.remove(source)
    with (settings.parent / "remove.log").open("a") as log:
        log.write(source + "\\n")
settings.write_text(json.dumps(current))
`, { mode: 0o755 });

  for (const existing of [false, true]) {
    const home = path.join(temp, existing ? "existing home" : "new home");
    const config = path.join(home, "custom pi config");
    const skillsDir = path.join(home, ".agents", "skills");
    const settingsPath = path.join(config, "settings.json");
    await mkdir(config, { recursive: true });
    const originalSettings = { packages: ["npm:stepstone", "npm:keep-me", "git:github.com/elpapi42/pi-observational-memory"], quietStartup: true };
    if (existing) {
      await writeFile(settingsPath, JSON.stringify(originalSettings));
      await mkdir(path.join(config, "retired-resources.occupied"));
      await writeFile(path.join(config, "retired-resources.occupied", "marker"), "Keep this backup.\n");
      await mkdir(path.join(config, "agents"));
      await mkdir(path.join(config, "extensions"));
      await writeFile(path.join(config, "agents", "my-agent.md"), "Keep this agent.\n");
      await writeFile(path.join(config, "extensions", "my-extension.ts"), "// Keep this extension.\n");
    }
    const retiredFiles = new Map([
      [path.join(config, "agents", "reviewer.md"), Buffer.from("Modified reviewer profile\n")],
      [path.join(config, "agents", "review-pass.md"), Buffer.from("Modified review-pass profile\n")],
      [path.join(config, "extensions", "read-only-git.ts"), Buffer.from("// Modified extension\n")],
      [path.join(skillsDir, "iterative-review", "SKILL.md"), Buffer.from("Modified iterative-review skill\n")],
      [path.join(skillsDir, "iterative-review", "data.bin"), Buffer.from([0, 255, 10])],
      [path.join(skillsDir, "reviewed-pr", "SKILL.md"), Buffer.from("Modified reviewed-pr skill\n")],
    ]);
    if (existing) for (const [file, bytes] of retiredFiles) {
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes);
    }
    const externalFiles = new Map();
    for (const name of externalSkills) {
      const dir = path.join(skillsDir, name);
      await mkdir(dir, { recursive: true });
      const files = new Map([
        ["SKILL.md", Buffer.from(`---\nname: ${name}\ndescription: Test skill.\n---\n\nKeep this skill.\n`)],
        ["data.bin", Buffer.from([0, 1, 255, 10])],
      ]);
      externalFiles.set(name, files);
      for (const [file, bytes] of files) await writeFile(path.join(dir, file), bytes);
    }
    const assertExternalSkills = async () => {
      for (const [name, files] of externalFiles) {
        assert.deepEqual((await readdir(path.join(skillsDir, name))).sort(), [...files.keys()].sort());
        for (const [file, bytes] of files) {
          assert.deepEqual(await readFile(path.join(skillsDir, name, file)), bytes);
        }
      }
    };

    const runInstall = () => execFileSync("bash", [path.join(root, "install.sh")], {
      cwd: home,
      env: { ...process.env, HOME: home, PI_CODING_AGENT_DIR: config, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
      encoding: "utf8",
      timeout: 30_000,
      stdio: "pipe",
    });
    runInstall();
    await assertExternalSkills();

    let migrationBackup;
    let settingsBackup;
    if (existing) {
      const files = await readdir(config);
      const backups = files.filter((name) => name.startsWith("retired-resources.") && name !== "retired-resources.occupied");
      assert.equal(backups.length, 1);
      migrationBackup = path.join(config, backups[0]);
      assert.equal(await readFile(path.join(config, "retired-resources.occupied", "marker"), "utf8"), "Keep this backup.\n");
      assert.equal(await readFile(path.join(config, "agents", "my-agent.md"), "utf8"), "Keep this agent.\n");
      assert.equal(await readFile(path.join(config, "extensions", "my-extension.ts"), "utf8"), "// Keep this extension.\n");
      for (const [file, bytes] of retiredFiles) {
        const relative = file.startsWith(skillsDir + path.sep)
          ? path.join("skills", path.relative(skillsDir, file))
          : path.relative(config, file);
        await assert.rejects(readFile(file), { code: "ENOENT" });
        assert.deepEqual(await readFile(path.join(migrationBackup, relative)), bytes);
      }
      settingsBackup = files.find((name) => name.startsWith("settings.json.backup."));
      assert.ok(settingsBackup);
      assert.deepEqual(JSON.parse(await readFile(path.join(config, settingsBackup), "utf8")), originalSettings);
    }

    runInstall();
    await assertExternalSkills();
    if (existing) {
      assert.equal((await readdir(config)).filter((name) => name.startsWith("retired-resources.")).length, 2);
      assert.equal((await readdir(config)).filter((name) => name.startsWith("settings.json.backup.")).length, 2);
      assert.deepEqual(JSON.parse(await readFile(path.join(config, settingsBackup), "utf8")), originalSettings);
      assert.equal(await readFile(path.join(config, "remove.log"), "utf8"),
        "npm:stepstone\ngit:github.com/elpapi42/pi-observational-memory\n");
      assert.equal(await readFile(path.join(config, "agents", "my-agent.md"), "utf8"), "Keep this agent.\n");
      assert.equal(await readFile(path.join(config, "extensions", "my-extension.ts"), "utf8"), "// Keep this extension.\n");
      for (const [file, bytes] of retiredFiles) {
        const relative = file.startsWith(skillsDir + path.sep)
          ? path.join("skills", path.relative(skillsDir, file))
          : path.relative(config, file);
        assert.deepEqual(await readFile(path.join(migrationBackup, relative)), bytes);
      }
    }
    const installed = JSON.parse(await readFile(settingsPath, "utf8"));
    const { packages, ...preferences } = template;
    for (const [key, value] of Object.entries(preferences)) assert.deepEqual(installed[key], value);
    assert.deepEqual(installed.packages, existing ? ["npm:keep-me", ...packages] : packages);
    if (existing) assert.equal(installed.quietStartup, true);

    for (const name of ownedSkills) {
      assert.equal(await readFile(path.join(skillsDir, name, "SKILL.md"), "utf8"),
        await readFile(path.join(root, "skills", name, "SKILL.md"), "utf8"));
    }
    const activeAgents = (await readdir(path.join(root, "agents"))).sort();
    const installedAgents = (await readdir(path.join(config, "agents"))).sort();
    assert.deepEqual(installedAgents, existing ? [...activeAgents, "my-agent.md"].sort() : activeAgents);
    for (const inactive of ["reviewer.md", "review-pass.md"]) {
      assert.ok(!installedAgents.includes(inactive), `${inactive} must not be installed`);
    }
    for (const name of activeAgents) {
      assert.equal(await readFile(path.join(config, "agents", name), "utf8"),
        await readFile(path.join(root, "agents", name), "utf8"));
    }
    const loaded = loadSkillsFromDir({ dir: skillsDir, source: "test" });
    assert.deepEqual(loaded.diagnostics, []);
    assert.deepEqual(loaded.skills.map((skill) => skill.name).sort(), [...ownedSkills, ...externalSkills].sort());
  }

  const resources = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).pi;
  assert.deepEqual(resources.skills, [], "Shared skills must not also load as package resources");
  assert.deepEqual((await readdir(path.join(root, "skills"))).filter((name) => !name.startsWith(".")).sort(), ownedSkills);
  console.log("Installer tests passed: active agents and packages match; external skills stay unchanged.");
} finally {
  await rm(temp, { recursive: true, force: true });
}
