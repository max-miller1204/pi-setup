# Pi Setup Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `pi-setup` reproduce Max Miller's current active Pi setup while preserving inactive review resources under `dormant/`.

**Architecture:** Keep active resources in the package discovery paths and move inactive resources outside those paths. Make installer and smoke tests assert both halves: active resources load, while dormant resources remain tracked but undiscovered.

**Tech Stack:** Bash, Python 3, Node.js, TypeScript, Pi 0.87.0 RPC mode, npm.

**Spec:** `docs/superpowers/specs/2026-09-21-pi-087-extension-coordination-design.md`

## Global Constraints

- Start only after observational memory, interactive subagents, and session tasks have verified revisions.
- Use `git:github.com/max-miller1204/pi-observational-memory`.
- Do not modify `pi-mcp-adapter` or `pi-web-access`.
- Remove stepstone and add session tasks plus superpowers.
- Keep dormant review resources in Git but outside Pi and installer discovery paths.
- Use exact Pi development version `0.87.0`.
- Preserve unrelated external skills and settings.
- Do not add compatibility fallbacks.

## Review Focus

- An unmatched active-skills glob must not create or copy a literal `*` directory.
- Repeated installation must not reactivate or delete dormant resources.
- Existing external skills named `superpowers`, `mcp-scripting`, or `playwright-cli` must remain unchanged.
- Package extension discovery must not recurse into `dormant/extensions`.
- An existing settings file must keep unrelated preferences while replacing portable setup values.

---

### Task 1: Move review resources outside active discovery paths

**Files:**
- Move: `agents/reviewer.md` to `dormant/agents/reviewer.md`
- Move: `agents/review-pass.md` to `dormant/agents/review-pass.md`
- Move: `extensions/read-only-git.ts` to `dormant/extensions/read-only-git.ts`
- Move: `skills/iterative-review/` to `dormant/skills/iterative-review/`
- Move: `skills/reviewed-pr/` to `dormant/skills/reviewed-pr/`
- Move: `scripts/test-read-only-git.mjs` to `dormant/tests/test-read-only-git.mjs`
- Create: `skills/.gitkeep`
- Modify: `package.json`
- Modify: `scripts/smoke-extensions.mjs`

**Interfaces:**
- Produces: Active Pi resources limited to four agents and two extensions.
- Preserves: Dormant source and tests under `dormant/`.

- [ ] **Step 1: Add a failing resource-layout assertion**

Create `scripts/test-resource-layout.mjs`:

```js
import assert from "node:assert/strict";
import { access, readdir } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
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
```

Add script:

```json
"test:resource-layout": "node scripts/test-resource-layout.mjs"
```

Add it near the start of `check`.

- [ ] **Step 2: Run the layout test and confirm failure**

```bash
npm run test:resource-layout
```

Expected: FAIL because review resources are still active.

- [ ] **Step 3: Move the resources**

```bash
mkdir -p dormant/agents dormant/extensions dormant/skills dormant/tests
mv agents/reviewer.md agents/review-pass.md dormant/agents/
mv extensions/read-only-git.ts dormant/extensions/
mv skills/iterative-review skills/reviewed-pr dormant/skills/
mv scripts/test-read-only-git.mjs dormant/tests/
touch skills/.gitkeep
```

- [ ] **Step 4: Remove dormant tests and tools from active checks**

Remove `test:read-only-git` from `package.json` scripts and `check`.

Change `scripts/smoke-extensions.mjs` to:

```js
const args = [
  "--mode", "rpc",
  "--no-session",
  "--no-context-files",
  "--no-skills",
  "--no-prompt-templates",
  "--no-extensions",
  "--tools", "ask_user_question",
  "-e", path.join(root, "extensions", "ask-user-question.ts"),
  "-e", path.join(root, "extensions", "custom-header.ts"),
];
```

Update its final message to say Pi loaded both active extensions.

- [ ] **Step 5: Run resource and smoke tests**

```bash
npm run test:resource-layout
npm run smoke:extensions
```

Expected: PASS. RPC output has no `extension_error`.

- [ ] **Step 6: Commit**

```bash
git add agents extensions skills dormant scripts package.json
git commit -m "chore: move review resources to dormant storage"
```

### Task 2: Match the active package and preference configuration

**Files:**
- Modify: `config/settings.json`
- Modify: `install.sh`
- Modify: `scripts/test-install.mjs`

**Interfaces:**
- Produces: Exact active package list from the approved specification.

- [ ] **Step 1: Update installer test expectations first**

Set the expected package array to:

```js
const expectedPackages = [
  "npm:pi-web-access",
  "git:github.com/max-miller1204/pi-observational-memory",
  "npm:pi-mcp-adapter",
  "git:github.com/max-miller1204/pi-interactive-subagents",
  "git:github.com/max-miller1204/pi-setup",
  "git:github.com/obra/superpowers",
  "git:github.com/max-miller1204/pi-session-tasks",
];
```

Assert `template.packages` equals this array and `template.externalEditor === "nvim"`.

Change `ownedSkills` to an empty array. Keep test fixtures for `mcp-scripting`, `playwright-cli`, `superpowers`, and `unrelated-skill`. Assert every external skill remains byte-identical after repeated installs.

Assert installed agents equal only the active `agents/` directory and that `reviewer.md` plus `review-pass.md` are absent.

- [ ] **Step 2: Run installer tests and confirm failure**

```bash
npm run test:install
```

Expected: FAIL on package list, editor preference, active agents, or owned skills.

- [ ] **Step 3: Update `config/settings.json`**

Replace `packages` with the exact approved order and add:

```json
"externalEditor": "nvim"
```

Do not copy `lastChangelogVersion` or local paths.

- [ ] **Step 4: Update `install.sh` package list**

Use the same seven entries and order as `config/settings.json`. Remove `npm:stepstone`.

Enable safe empty-skill iteration:

```bash
shopt -s nullglob
active_skill_dirs=("$repo_dir"/skills/*/)
for skill_dir in "${active_skill_dirs[@]}"; do
  skill_name="$(basename "$skill_dir")"
  target="$skills_dir/$skill_name"
  if [[ -e "$target" || -L "$target" ]]; then
    if [[ -z "$skills_backup" ]]; then
      skills_backup="$(mktemp -d "$config_dir/skills-backup.XXXXXX")"
      echo "Backed up skills to $skills_backup"
    fi
    cp -RL "$target" "$skills_backup/$skill_name"
  fi
  mkdir -p "$target"
  cp -R "$skill_dir". "$target/"
done
```

Do not special-case superpowers. It is an external package skill and is not copied by this repository.

- [ ] **Step 5: Run installer tests**

```bash
npm run test:install
```

Expected: PASS for new and existing homes, including repeated installation.

- [ ] **Step 6: Commit**

```bash
git add config/settings.json install.sh scripts/test-install.mjs
git commit -m "feat: align setup packages with local Pi configuration"
```

### Task 3: Pin the setup development runtime to Pi 0.87.0

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `scripts/check-dependencies.mjs`

**Interfaces:**
- Produces: Exact Pi 0.87.0 development API with broad runtime peers.

- [ ] **Step 1: Add an exact-version guard**

In `scripts/check-dependencies.mjs`, after loading `package.json` and the lockfile, assert direct development versions:

```js
const requiredPiVersion = "0.87.0";
for (const name of ["@earendil-works/pi-coding-agent", "@earendil-works/pi-tui"]) {
  if (packageJson.devDependencies?.[name] !== requiredPiVersion) {
    failures.push(`package.json devDependencies must pin ${name}@${requiredPiVersion}`);
  }
  if (lock.packages?.[`node_modules/${name}`]?.version !== requiredPiVersion) {
    failures.push(`package-lock.json must resolve ${name}@${requiredPiVersion}`);
  }
}
```

Move lockfile parsing before this block so `lock` is defined once.

- [ ] **Step 2: Run the guard and confirm failure**

```bash
npm run check:dependencies
```

Expected: FAIL because exact Pi dev dependencies are absent and the lock resolves 0.84.4.

- [ ] **Step 3: Install exact development packages**

```bash
npm install --save-dev --save-exact \
  @earendil-works/pi-coding-agent@0.87.0 \
  @earendil-works/pi-tui@0.87.0 \
  typebox@1.3.27
```

Keep runtime peers as wildcards.

- [ ] **Step 4: Run dependency and type checks**

```bash
npm run check:dependencies
npm run typecheck
npm run smoke:extensions
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json scripts/check-dependencies.mjs
git commit -m "chore: verify setup against Pi 0.87"
```

### Task 4: Update setup documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/setup.md`
- Modify: `docs/maintenance.md`
- Modify: `docs/read-only-git.md`

**Interfaces:**
- Produces: Documentation that distinguishes active and dormant resources.

- [ ] **Step 1: Update the package overview**

State that active resources are:

- `ask-user-question` and `custom-header` extensions;
- browser-worker, researcher, scout, and worker agents;
- superpowers and session-tasks packages;
- the observational-memory fork.

State that reviewer, review-pass, read-only-git, iterative-review, and reviewed-pr are preserved under `dormant/` and are not installed or loaded.

- [ ] **Step 2: Update maintenance commands**

Remove commands that copy active review skills. Explain that restoring a dormant resource requires moving it back into its active directory and updating tests in the same change.

Mark `docs/read-only-git.md` as dormant at the top. Point to `dormant/extensions/read-only-git.ts` and `dormant/tests/test-read-only-git.mjs`.

- [ ] **Step 3: Scan for stale claims**

```bash
rg -n 'stepstone|elpapi42/pi-observational-memory|reviewer|review-pass|read-only-git|iterative-review|reviewed-pr' README.md docs config install.sh package.json scripts
```

Expected: each remaining review-resource reference labels it dormant. No stepstone or upstream observational-memory package locator remains.

- [ ] **Step 4: Commit**

```bash
git add README.md docs
git commit -m "docs: describe active and dormant Pi resources"
```

### Task 5: Complete setup verification

**Files:**
- Modify only when a failing check identifies a scoped defect.

**Interfaces:**
- Produces: Final evidence for the complete setup branch.

- [ ] **Step 1: Install exactly from the lockfile**

```bash
npm ci --ignore-scripts
```

Expected: exit 0.

- [ ] **Step 2: Run the complete setup check**

```bash
npm run check
```

Expected: dependency guard, resource layout, theme ownership, installer tests, typecheck, and two-extension RPC smoke test all pass.

- [ ] **Step 3: Run the security audit**

```bash
npm audit --audit-level=low
```

Expected: zero vulnerabilities at or above low severity.

- [ ] **Step 4: Verify package discovery boundaries**

```bash
node - <<'NODE'
const p = require('./package.json');
if (JSON.stringify(p.pi.extensions) !== JSON.stringify(['./extensions/*.ts'])) throw new Error('unexpected extension discovery');
const s = require('./config/settings.json');
console.log(s.packages.join('\n'));
NODE
find agents extensions skills dormant -maxdepth 3 -type f | sort
git diff --check
git status --short
```

Expected: only active extension glob, exact seven packages, and dormant files outside active directories.

- [ ] **Step 5: Commit any final test-only corrections**

If Step 2 through Step 4 required a scoped correction:

```bash
git add package.json package-lock.json scripts README.md docs config install.sh agents extensions skills dormant
git commit -m "test: enforce refreshed Pi setup"
```

If no correction was required, do not create an empty commit.
