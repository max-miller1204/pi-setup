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
assert sys.argv[1] == "install"
settings = Path(os.environ["PI_CODING_AGENT_DIR"]) / "settings.json"
current = json.loads(settings.read_text()) if settings.exists() else {}
packages = current.setdefault("packages", [])
if sys.argv[2] not in packages:
    packages.append(sys.argv[2])
settings.write_text(json.dumps(current))
`, { mode: 0o755 });

  for (const existing of [false, true]) {
    const home = path.join(temp, existing ? "existing home" : "new home");
    const config = path.join(home, "custom pi config");
    const skillsDir = path.join(home, ".agents", "skills");
    const settingsPath = path.join(config, "settings.json");
    await mkdir(config, { recursive: true });
    const originalSettings = { packages: ["npm:keep-me"], quietStartup: true };
    if (existing) {
      await writeFile(settingsPath, JSON.stringify(originalSettings));
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

    if (existing) {
      const files = await readdir(config);
      assert.equal(files.some((name) => name.startsWith("skills-backup.")), false);
      const settingsBackup = files.find((name) => name.startsWith("settings.json.backup."));
      assert.ok(settingsBackup);
      assert.deepEqual(JSON.parse(await readFile(path.join(config, settingsBackup), "utf8")), originalSettings);
    }

    runInstall();
    await assertExternalSkills();
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
    assert.deepEqual(installedAgents, activeAgents);
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
