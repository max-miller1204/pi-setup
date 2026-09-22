# Pi 0.87 Extension Coordination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coordinate four repository plans so Pi 0.87 lifecycle, memory, dependency, and setup changes land in a safe order.

**Architecture:** Each repository has an independent plan, branch, test suite, and commit history. Complete package repositories first, then update `pi-setup` to reference their verified locations.

**Tech Stack:** Git, GitHub, TypeScript, Node.js, npm, Pi 0.87.0.

**Spec:** `docs/superpowers/specs/2026-09-21-pi-087-extension-coordination-design.md`

## Global Constraints

- Do not modify `pi-mcp-adapter` or `pi-web-access`.
- Use separate focused branches for each repository.
- Require fresh test evidence before integration.
- Keep the interactive-subagents implementation in a worker subagent.
- Clone observational memory from Max Miller's fork.
- Update `pi-setup` last.
- Do not add compatibility fallbacks.

## Review Focus

- `pi-setup` must not point at a package revision that lacks its repository's passing checks.
- The observational-memory fork `master` must contain `fix/pi-087-finish-turn` before the new branch starts.
- Parallel workers must not edit the same repository or shared worktree.
- Lockfile refreshes must resolve Pi 0.87.0, not a newer floating version.
- Final setup tests must prove dormant resources are not loaded.

---

### Task 1: Implement observational-memory coordination

**Files:**
- Plan: `docs/superpowers/plans/2026-09-21-observational-memory-pi-087.md`

**Interfaces:**
- Produces: Verified branch `feat/pi-087-context-coordination` in `max-miller1204/pi-observational-memory`.

- [ ] **Step 1: Execute the repository plan**

Follow every checkbox in `2026-09-21-observational-memory-pi-087.md` in order.

- [ ] **Step 2: Record integration evidence**

Record the final commit SHA and outputs from `npm run typecheck` and `npm test` in the execution summary.

### Task 2: Update interactive subagents in a worker

**Files:**
- Plan: `docs/superpowers/plans/2026-09-21-interactive-subagents-pi-087.md`

**Interfaces:**
- Produces: Verified branch `feat/pi-087-lifecycle` in `pi-interactive-subagents`.

- [ ] **Step 1: Dispatch one worker with isolated repository scope**

Give the worker the spec path, repository plan path, repository path, and instruction not to edit any other repository.

- [ ] **Step 2: Review worker output independently**

Inspect the diff. Run:

```bash
npm run check:pi-versions
npm test
npm run test:integration
```

Record the final commit SHA and command outputs.

### Task 3: Refresh session tasks

**Files:**
- Plan: `docs/superpowers/plans/2026-09-21-session-tasks-pi-087.md`

**Interfaces:**
- Produces: Verified branch `chore/pi-087-lockfile` in `pi-session-tasks`.

- [ ] **Step 1: Execute the repository plan**

Follow every checkbox in `2026-09-21-session-tasks-pi-087.md` in order.

- [ ] **Step 2: Record integration evidence**

Record the final commit SHA and output from `npm run check` and `npm audit --audit-level=low`.

### Task 4: Refresh pi-setup last

**Files:**
- Plan: `docs/superpowers/plans/2026-09-21-pi-setup-refresh.md`

**Interfaces:**
- Consumes: Verified repository revisions from Tasks 1 through 3.
- Produces: Complete `feat/pi-087-extension-coordination` branch.

- [ ] **Step 1: Execute the setup plan**

Follow every checkbox in `2026-09-21-pi-setup-refresh.md` in order.

- [ ] **Step 2: Run final cross-repository checks**

```bash
rg -n 'npm:stepstone|git:github.com/elpapi42/pi-observational-memory' ~/pi-setup \
  --glob '!node_modules/**' --glob '!docs/superpowers/**'
node -e 'const s=require(process.env.HOME+"/pi-setup/config/settings.json"); console.log(s.packages)'
```

Expected: no stale package references and the exact approved seven-package list.

- [ ] **Step 3: Review all repository states**

```bash
for repo in \
  "$HOME/pi-observational-memory" \
  "$HOME/.pi/agent/git/github.com/max-miller1204/pi-interactive-subagents" \
  "$HOME/pi-session-tasks" \
  "$HOME/pi-setup"; do
  echo "== $repo =="
  git -C "$repo" status --short --branch
  git -C "$repo" log -3 --oneline --decorate
done
```

Expected: each repository is on its scoped branch with no uncommitted implementation files.

### Task 5: Request final review

**Files:**
- Review all four branch diffs.

**Interfaces:**
- Consumes: Verified branches from Tasks 1 through 4.
- Produces: Evidence-backed integration recommendation.

- [ ] **Step 1: Dispatch a whole-change reviewer**

Give the reviewer the approved spec, all four plans, final commit SHAs, and test outputs. Ask it to inspect behavior, tests, cross-repository references, and unintended scope.

- [ ] **Step 2: Apply only verified review findings**

For each accepted finding, add or update a failing test first, make the minimum correction in the owning repository, and rerun that repository's complete verification command.

- [ ] **Step 3: Present integration choices**

Report each repository branch, commit SHA, verification evidence, and any remaining risks. Ask before merging or creating pull requests unless prior instructions already authorize those operations.
