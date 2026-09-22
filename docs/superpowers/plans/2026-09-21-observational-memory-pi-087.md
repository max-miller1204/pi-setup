# Observational Memory Pi 0.87 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make observational-memory compaction wait for active workers, remove the settled-handler timer, and omit covered retained messages through supported Pi 0.87 context edits.

**Architecture:** Keep memory workers asynchronous during ordinary turns. Await the tracked worker promise only at compaction boundaries, derive cleanup from committed branch history, and append cleanup through actionable `turn_end` results.

**Tech Stack:** TypeScript, Vitest, Pi extension API 0.87.0, npm.

**Spec:** `~/pi-setup/docs/superpowers/specs/2026-09-21-pi-087-extension-coordination-design.md`

## Global Constraints

- Clone `https://github.com/max-miller1204/pi-observational-memory.git` as the implementation repository.
- Merge `fix/pi-087-finish-turn` into the fork's `master` before creating the feature branch.
- Do not reimplement or discard the existing `finishTurn` migration.
- Keep normal agent turns responsive.
- Do not mutate `ReadonlySessionManager` through a cast.
- Do not return `continue: true`.
- Preserve raw history, exports, recall, and branch behavior.
- Use Pi packages at exact development version `0.87.0`.
- Do not add compatibility fallbacks.

## Review Focus

- A worker that appends memory while compaction waits must appear in the generated summary.
- A failed worker must finish diagnostics before compaction reads the last committed ledger.
- A retain-none compaction must produce no cleanup targets.
- A replacement context edit after an omission must remain eligible for a later cleanup decision.
- A branch without the qualifying compaction and coverage entries must not inherit cleanup from another branch.

---

### Task 1: Prepare the fork baseline and Pi 0.87 development environment

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Verify: `src/agents/observer/agent.ts`
- Verify: `src/agents/reflector/agent.ts`
- Verify: `src/agents/dropper/agent.ts`
- Test: `tests/observer.test.ts`

**Interfaces:**
- Consumes: Fork branch `fix/pi-087-finish-turn`.
- Produces: Fork `master` containing the migration and feature branch `feat/pi-087-context-coordination` with Pi 0.87.0 development packages.

- [ ] **Step 1: Clone the fork and inspect branch state**

```bash
cd ~
git clone https://github.com/max-miller1204/pi-observational-memory.git
cd ~/pi-observational-memory
git fetch origin
git status --short --branch
git log --oneline --decorate --all -12
```

Expected: a clean checkout, `origin/master`, and `origin/fix/pi-087-finish-turn`.

- [ ] **Step 2: Merge the existing migration into fork master**

```bash
git switch master
git pull --ff-only origin master
git merge --no-ff origin/fix/pi-087-finish-turn -m "Merge Pi 0.87 finishTurn migration"
npm install
npm run typecheck
npm test
git push origin master
```

Expected: typecheck and tests pass before push. Resolve no unrelated files during the merge.

- [ ] **Step 3: Create the feature branch**

```bash
git switch -c feat/pi-087-context-coordination
```

- [ ] **Step 4: Pin Pi 0.87 development dependencies**

Run:

```bash
npm install --save-dev --save-exact \
  @earendil-works/pi-agent-core@0.87.0 \
  @earendil-works/pi-ai@0.87.0 \
  @earendil-works/pi-coding-agent@0.87.0 \
  @earendil-works/pi-tui@0.87.0
```

Expected: the four Pi entries in `package.json` and their lockfile resolutions are exactly `0.87.0`.

- [ ] **Step 5: Verify the merged migration against Pi 0.87**

```bash
npm run typecheck
npm test -- --run tests/observer.test.ts tests/reflector.test.ts tests/dropper.test.ts
```

Expected: PASS. `rg -n 'shouldStopAfterTurn' src tests` returns no matches.

- [ ] **Step 6: Commit the baseline**

```bash
git add package.json package-lock.json
git commit -m "chore: test observational memory against Pi 0.87"
```

### Task 2: Wait for workers at the compaction hook

**Files:**
- Modify: `src/hooks/compaction-hook.ts`
- Modify: `tests/compaction-hook.test.ts`

**Interfaces:**
- Consumes: `Runtime.consolidationPromise: Promise<void> | null` and `ctx.sessionManager.getBranch()`.
- Produces: `session_before_compact` handler that waits and then reads a fresh branch.

- [ ] **Step 1: Replace the old no-wait regression test with worker-ordering tests**

Add tests that use a deferred promise:

```ts
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

it("waits for consolidation and builds from the refreshed branch", async () => {
  const gate = deferred();
  const stale = [textCustomMessage("raw-1", "aaaa")];
  const obs = observation("aaaaaaaaaaaa", { sourceEntryIds: ["raw-1"] });
  const fresh = [
    ...stale,
    observationsRecordedEntry("om-1", { observations: [obs], coversUpToId: "raw-1" }),
  ];
  const h = setup({ entries: stale });
  h.runtime.consolidationPromise = gate.promise;
  h.ctx.sessionManager.getBranch
    .mockReturnValueOnce(stale)
    .mockReturnValueOnce(fresh);

  const resultPromise = h.run("raw-1");
  await Promise.resolve();
  expect(h.ctx.sessionManager.getBranch).not.toHaveBeenCalled();
  gate.resolve();

  const result = await resultPromise as any;
  expect(result.compaction.details.observations).toHaveLength(1);
});
```

Also add a test where the worker terminates after recording an error and the hook uses the last committed branch without hanging.

- [ ] **Step 2: Run the focused test and confirm failure**

```bash
npm test -- --run tests/compaction-hook.test.ts
```

Expected: FAIL because the hook does not await `consolidationPromise` and still reads `event.branchEntries`.

- [ ] **Step 3: Implement the worker wait and fresh branch read**

Change the handler body before projection construction:

```ts
const activeConsolidation = runtime.consolidationPromise;
if (activeConsolidation) await activeConsolidation;

const { preparation } = event;
const branchEntries = ctx.sessionManager.getBranch() as Entry[];
const { firstKeptEntryId, tokensBefore } = preparation;
```

Keep duplicate-compaction locking and the existing `finally` reset.

- [ ] **Step 4: Run focused and full tests**

```bash
npm test -- --run tests/compaction-hook.test.ts tests/runtime.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/compaction-hook.ts tests/compaction-hook.test.ts
git commit -m "fix: wait for memory workers before compaction"
```

### Task 3: Remove timer-based settled compaction scheduling

**Files:**
- Modify: `src/hooks/compaction-trigger.ts`
- Modify: `tests/compaction-trigger.test.ts`

**Interfaces:**
- Consumes: `Runtime.consolidationPromise`, `ctx.isIdle()`, `ctx.compact()`.
- Produces: Async `agent_settled` handler that directly requests deferred Pi compaction.

- [ ] **Step 1: Rewrite the harness for an async handler**

Change the captured handler type to return `Promise<void>`. Remove fake-timer setup. Set `consolidationPromise: null` in the default runtime fixture.

Add a deferred-worker test:

```ts
it("waits for consolidation before requesting compaction", async () => {
  const gate = deferred();
  const { handler, runtime } = captureHandler({ compactAfterTokens: 3 });
  runtime.consolidationPromise = gate.promise;
  const ctx = fakeCtx([dueBranch, dueBranch]);

  const pending = handler(agentSettled(), ctx);
  await Promise.resolve();
  expect(ctx.compact).not.toHaveBeenCalled();
  gate.resolve();
  await pending;

  expect(ctx.compact).toHaveBeenCalledTimes(1);
});
```

Add tests that the post-wait branch is below threshold, the context became busy, and the worker terminal result clears `compactInFlight` when `ctx.compact()` throws synchronously.

- [ ] **Step 2: Run the focused test and confirm failure**

```bash
npm test -- --run tests/compaction-trigger.test.ts
```

Expected: FAIL because current code returns before its timer and does not await the worker.

- [ ] **Step 3: Implement direct settled scheduling**

Replace the timer block with this control shape:

```ts
pi.on("agent_settled", async (_event, ctx) => {
  runtime.ensureConfig(ctx.cwd);
  if (runtime.config.passive === true || runtime.compactInFlight) return;

  const entries = ctx.sessionManager.getBranch() as Entry[];
  const progress = rawTokensSinceLastCompaction(entries);
  const contextWindow = typeof ctx.model?.contextWindow === "number"
    ? ctx.model.contextWindow
    : undefined;
  const threshold = resolveCompactAfterTokens(runtime.config, contextWindow);
  if (progress < threshold) return;

  runtime.compactInFlight = true;
  try {
    const activeConsolidation = runtime.consolidationPromise;
    if (activeConsolidation) await activeConsolidation;
    if (!ctx.isIdle()) {
      runtime.compactInFlight = false;
      return;
    }
    const currentEntries = ctx.sessionManager.getBranch() as Entry[];
    if (rawTokensSinceLastCompaction(currentEntries) < threshold) {
      runtime.compactInFlight = false;
      return;
    }
    ctx.compact({
      onComplete: () => {
        runtime.compactInFlight = false;
        if (hasUI) ui?.notify("Observational memory: compaction complete", "info");
      },
      onError: (error: { message: string }) => {
        runtime.compactInFlight = false;
        if (error.message === "Compaction cancelled") return;
        if (hasUI) ui?.notify(`Observational memory: ${error.message}`, "error");
      },
    });
  } catch (error) {
    runtime.compactInFlight = false;
    throw error;
  }
});
```

Retain the existing user notifications and cancellation message behavior. Do not add `setTimeout`.

- [ ] **Step 4: Run focused and full tests**

```bash
npm test -- --run tests/compaction-trigger.test.ts
npm run typecheck
npm test
```

Expected: PASS. `rg -n 'setTimeout' src/hooks/compaction-trigger.ts` returns no matches.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/compaction-trigger.ts tests/compaction-trigger.test.ts
git commit -m "refactor: schedule compaction from settled boundary"
```

### Task 4: Derive post-compaction context cleanup

**Files:**
- Create: `src/session-ledger/context-cleanup.ts`
- Create: `tests/session-ledger-context-cleanup.test.ts`
- Modify: `src/session-ledger/types.ts`
- Modify: `src/session-ledger/index.ts`
- Modify: `tests/fixtures/session.ts`

**Interfaces:**
- Produces: `buildPostCompactionContextEdits(entries: Entry[], proposedEntries?: readonly SessionBoundaryDraft[]): ContextEditEntryDraft[]`.
- Consumes: Active branch entries and boundary drafts proposed by earlier handlers.

- [ ] **Step 1: Extend the local entry model and fixtures**

Add optional fields to `Entry` and `TestEntry`:

```ts
targetId?: string;
replacement?: unknown;
```

Add a fixture:

```ts
export function contextEditEntry(
  id: string,
  targetId: string,
  replacement: unknown = null,
): TestEntry {
  return {
    type: "context_edit",
    id,
    parentId: null,
    timestamp: DEFAULT_TIMESTAMP,
    targetId,
    replacement,
  };
}
```

- [ ] **Step 2: Write failing pure-function tests**

Cover these exact cases:

```ts
it("omits covered messages retained by the latest memory compaction", () => {
  const entries = [
    rawMessage("user-1", "request"),
    rawMessage("assistant-1", "reply", { message: { role: "assistant", content: [{ type: "text", text: "reply" }] } }),
    observationsRecordedEntry("om-1", {
      observations: [observation("aaaaaaaaaaaa", { sourceEntryIds: ["user-1", "assistant-1"] })],
      coversUpToId: "assistant-1",
    }),
    compactionEntry("cmp-1", {
      firstKeptEntryId: "user-1",
      details: memoryDetails({ observations: [observation("aaaaaaaaaaaa")] }),
    }),
  ];

  expect(buildPostCompactionContextEdits(entries)).toEqual([
    { type: "context_edit", targetId: "user-1", replacement: null },
    { type: "context_edit", targetId: "assistant-1", replacement: null },
  ]);
});
```

Also test system-message exclusion, branch-summary exclusion, unobserved messages, non-memory compaction, retain-none compaction, an existing null edit, an existing non-null replacement, earlier compactions, and proposed duplicate edits.

- [ ] **Step 3: Run the new test and confirm failure**

```bash
npm test -- --run tests/session-ledger-context-cleanup.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 4: Implement cleanup derivation**

Use Pi's exported draft types:

```ts
import type { ContextEditEntryDraft, SessionBoundaryDraft } from "@earendil-works/pi-coding-agent";
```

The function must:

1. Find the latest compaction whose `details` passes `isMemoryDetails`.
2. Resolve `firstKeptEntryId`; return `[]` when it is absent, equals the compaction ID, or is not on the branch.
3. Find the latest valid observations-recorded entry at or before the compaction whose covered target is also at or before the compaction.
4. Inspect only entries from the kept boundary through the entry before compaction.
5. Accept `message` entries with roles `user`, `assistant`, or `toolResult`, plus `custom_message` entries.
6. Exclude system messages and all other entry types.
7. Treat the latest branch `context_edit` and current `proposedEntries` as the active edit for each target.
8. Skip a target only when its active replacement is `null`.
9. Return drafts in source order.

Export the helper from `src/session-ledger/index.ts`.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
npm test -- --run tests/session-ledger-context-cleanup.test.ts tests/session-ledger-types.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/session-ledger/context-cleanup.ts src/session-ledger/types.ts src/session-ledger/index.ts tests/fixtures/session.ts tests/session-ledger-context-cleanup.test.ts
git commit -m "feat: derive post-compaction context cleanup"
```

### Task 5: Register actionable turn-end cleanup

**Files:**
- Create: `src/hooks/context-cleanup.ts`
- Create: `tests/context-cleanup-hook.test.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `buildPostCompactionContextEdits()` from Task 4 and `TurnEndEvent.entries`.
- Produces: `registerContextCleanup(pi: ExtensionAPI): void`.

- [ ] **Step 1: Write the failing hook test**

```ts
it("appends cleanup drafts without requesting continuation", async () => {
  const entries = qualifyingBranch();
  const event = { type: "turn_end", entries: [], continue: false } as any;
  const ctx = { sessionManager: { getBranch: () => entries } } as any;
  const result = await handler(event, ctx);

  expect(result).toEqual({
    entries: [
      { type: "context_edit", targetId: "user-1", replacement: null },
    ],
  });
  expect(result).not.toHaveProperty("continue");
});
```

Add tests that prior drafts are preserved, a nonqualifying branch returns `undefined`, and an edit proposed by an earlier handler is not duplicated.

- [ ] **Step 2: Run the focused test and confirm failure**

```bash
npm test -- --run tests/context-cleanup-hook.test.ts
```

Expected: FAIL because `registerContextCleanup` does not exist.

- [ ] **Step 3: Implement and register the hook**

```ts
export function registerContextCleanup(pi: ExtensionAPI): void {
  pi.on("turn_end", (event, ctx) => {
    const drafts = buildPostCompactionContextEdits(
      ctx.sessionManager.getBranch() as Entry[],
      event.entries,
    );
    if (drafts.length === 0) return;
    return { entries: [...event.entries, ...drafts] };
  });
}
```

Register it after `registerConsolidationTrigger()` in `src/index.ts`. Do not return `continue`.

- [ ] **Step 4: Run focused and full verification**

```bash
npm test -- --run tests/context-cleanup-hook.test.ts tests/session-ledger-context-cleanup.test.ts
npm run typecheck
npm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/context-cleanup.ts src/index.ts tests/context-cleanup-hook.test.ts
git commit -m "feat: omit covered retained context after compaction"
```

### Task 6: Update documentation and verify the branch

**Files:**
- Modify: `README.md`
- Modify: `docs/how-it-works.md`
- Modify: `docs/concepts.md`
- Modify: `docs/configuration.md`
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: Final lifecycle behavior from Tasks 2 through 5.
- Produces: Accurate operator and maintainer documentation.

- [ ] **Step 1: Update lifecycle documentation**

Document these facts:

- Memory work remains asynchronous during ordinary turns.
- Any compaction waits for the active pipeline.
- Proactive compaction runs directly from `agent_settled` without a timer.
- Context cleanup occurs on the first later `turn_end` after a successful memory compaction.
- Cleanup changes model context only. Raw history and recall remain intact.

Replace statements that compaction never waits for workers.

- [ ] **Step 2: Run documentation and code checks**

```bash
rg -n 'does not wait|setTimeout|shouldStopAfterTurn' README.md docs src tests AGENTS.md
npm run typecheck
npm test
git diff --check
```

Expected: no stale behavioral claims and all checks pass.

- [ ] **Step 3: Commit**

```bash
git add README.md docs AGENTS.md
git commit -m "docs: explain Pi 0.87 memory coordination"
```

- [ ] **Step 4: Final verification**

```bash
npm ci
npm run typecheck
npm test
git status --short
git log --oneline --decorate -8
```

Expected: all tests pass and only intentional commits appear on the feature branch.
