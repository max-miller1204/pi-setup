import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";

const root = process.cwd();
const temp = await mkdtemp(path.join(os.tmpdir(), "pi-setup-install-"));
const template = JSON.parse(await readFile(path.join(root, "config/settings.json"), "utf8"));
const ownedSkills = ["iterative-review", "reviewed-pr"];
const externalSkills = ["mcp-scripting", "playwright-cli"];

try {
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
      await mkdir(path.join(skillsDir, "iterative-review"), { recursive: true });
      await writeFile(path.join(skillsDir, "iterative-review", "SKILL.md"), "old custom skill\n");
    }
    for (const name of [...externalSkills, "unrelated-skill"]) {
      await mkdir(path.join(skillsDir, name), { recursive: true });
      await writeFile(path.join(skillsDir, name, "SKILL.md"),
        `---\nname: ${name}\ndescription: Test skill.\n---\n\nKeep this skill.\n`);
    }

    const runInstall = () => execFileSync("bash", [path.join(root, "install.sh")], {
      cwd: home,
      env: { ...process.env, HOME: home, PI_CODING_AGENT_DIR: config, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
      encoding: "utf8",
      timeout: 30_000,
      stdio: "pipe",
    });
    runInstall();

    if (existing) {
      const files = await readdir(config);
      const backup = files.find((name) => name.startsWith("skills-backup."));
      assert.ok(backup, "Existing skills must have a backup outside the discovery directory");
      assert.equal(await readFile(path.join(config, backup, "iterative-review", "SKILL.md"), "utf8"), "old custom skill\n");
      const settingsBackup = files.find((name) => name.startsWith("settings.json.backup."));
      assert.ok(settingsBackup);
      assert.deepEqual(JSON.parse(await readFile(path.join(config, settingsBackup), "utf8")), originalSettings);
    }

    runInstall();
    const installed = JSON.parse(await readFile(settingsPath, "utf8"));
    const { packages, ...preferences } = template;
    for (const [key, value] of Object.entries(preferences)) assert.deepEqual(installed[key], value);
    assert.deepEqual(installed.packages, existing ? ["npm:keep-me", ...packages] : packages);
    if (existing) assert.equal(installed.quietStartup, true);

    for (const name of ownedSkills) {
      assert.equal(await readFile(path.join(skillsDir, name, "SKILL.md"), "utf8"),
        await readFile(path.join(root, "skills", name, "SKILL.md"), "utf8"));
    }
    for (const name of [...externalSkills, "unrelated-skill"]) {
      assert.equal(await readFile(path.join(skillsDir, name, "SKILL.md"), "utf8"),
        `---\nname: ${name}\ndescription: Test skill.\n---\n\nKeep this skill.\n`);
    }
    for (const name of await readdir(path.join(root, "agents"))) {
      assert.equal(await readFile(path.join(config, "agents", name), "utf8"),
        await readFile(path.join(root, "agents", name), "utf8"));
    }
    const loaded = loadSkillsFromDir({ dir: skillsDir, source: "test" });
    assert.deepEqual(loaded.diagnostics, []);
    assert.deepEqual(loaded.skills.map((skill) => skill.name).sort(), [...ownedSkills, ...externalSkills, "unrelated-skill"].sort());
  }

  const resources = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).pi;
  assert.deepEqual(resources.skills, [], "Shared skills must not also load as package resources");
  assert.deepEqual((await readdir(path.join(root, "skills"))).sort(), ownedSkills);
  console.log("Installer tests passed: skills load, backups work, and external skills stay unchanged.");
} finally {
  await rm(temp, { recursive: true, force: true });
}
