# Session Tasks Pi 0.87 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin the session-tasks development environment to Pi 0.87.0 and prove the extension still passes its complete package checks.

**Architecture:** Keep runtime peer dependencies broad. Use exact development dependencies and the lockfile to define the tested Pi version.

**Tech Stack:** TypeScript, Vitest, Biome, npm, Pi 0.87.0.

**Spec:** `~/pi-setup/docs/superpowers/specs/2026-09-21-pi-087-extension-coordination-design.md`

## Global Constraints

- Work in `~/pi-session-tasks` on a focused branch from `main`.
- Keep runtime peer dependency ranges unchanged.
- Pin `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`, and `@earendil-works/pi-tui` to exact development version `0.87.0`.
- Do not change extension behavior unless a Pi 0.87 test or type error requires it.
- Do not add compatibility fallbacks.

## Review Focus

- The `context` hook must continue to preserve the task message while Pi restores prompt and tool state.
- Session reconstruction must tolerate new `context_edit` entries without treating them as task events.
- Package smoke tests must use the installed Pi 0.87 runtime, not a global executable.
- The packed npm artifact must not include tests, plans, or `node_modules`.
- Broad optional peers must remain available for Pi package hosting.

---

### Task 1: Pin and verify Pi 0.87.0

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `test/extension.test.ts`
- Test: `test/session-store.test.ts`
- Test: `test/package-smoke.test.ts`

**Interfaces:**
- Produces: A lockfile that resolves all direct Pi development packages to `0.87.0`.

- [ ] **Step 1: Create the feature branch**

```bash
cd ~/pi-session-tasks
git status --short --branch
git switch -c chore/pi-087-lockfile
```

Expected: clean branch from merged `main`.

- [ ] **Step 2: Record the current test baseline**

```bash
npm run check
```

Expected: PASS before dependency changes.

- [ ] **Step 3: Pin direct Pi development dependencies**

```bash
npm install --save-dev --save-exact \
  @earendil-works/pi-ai@0.87.0 \
  @earendil-works/pi-coding-agent@0.87.0 \
  @earendil-works/pi-tui@0.87.0
```

Keep the same names under `peerDependencies` and `peerDependenciesMeta` with wildcard runtime ranges.

- [ ] **Step 4: Add a lockfile-version assertion to package smoke coverage**

Add a test that loads `package-lock.json` and asserts:

```ts
for (const name of [
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
]) {
  expect(lock.packages[`node_modules/${name}`]?.version).toBe("0.87.0");
}
```

Also add a reconstruction case containing an unrelated `{ type: "context_edit" }` entry and assert that the task store remains unchanged.

- [ ] **Step 5: Run focused tests and confirm behavior**

```bash
npm test -- --run test/package-smoke.test.ts test/session-store.test.ts test/extension.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run complete verification**

```bash
npm ci
npm run check
npm audit --audit-level=low
git diff --check
```

Expected: all commands pass and the audit reports no vulnerability at or above low severity.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json test/package-smoke.test.ts test/session-store.test.ts
git commit -m "chore: verify session tasks against Pi 0.87"
```

- [ ] **Step 8: Record final evidence**

```bash
git status --short
git log -1 --oneline --decorate
node -e 'const p=require("./package-lock.json"); for (const n of ["@earendil-works/pi-ai","@earendil-works/pi-coding-agent","@earendil-works/pi-tui"]) console.log(n,p.packages[`node_modules/${n}`].version)'
```

Expected: clean branch and three `0.87.0` lines.
