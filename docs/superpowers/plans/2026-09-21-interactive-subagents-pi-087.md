# Interactive Subagents Pi 0.87 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move subagent auto-exit to Pi 0.87's final actionable lifecycle boundary and verify the package against Pi 0.87.0.

**Architecture:** Keep `agent_end` as a low-level activity signal. Make `agent_before_settle` the only place that decides final waiting or shutdown state, using its projected context after retries and queued work finish.

**Tech Stack:** TypeScript, Node test runner, Pi 0.87.0 extension API, tmux integration tests, npm.

**Spec:** `~/pi-setup/docs/superpowers/specs/2026-09-21-pi-087-extension-coordination-design.md`

## Global Constraints

- Implement this plan in a worker subagent.
- Use an isolated branch or worktree from `main`.
- Keep all Pi development packages on exact version `0.87.0`.
- Preserve pending-question, child-subagent, abort, error-sidecar, and normal auto-exit behavior.
- Do not shut down from `agent_end`.
- Do not return `continue: true`.
- Do not add compatibility fallbacks.

## Review Focus

- A low-level `agent_end` followed by automatic retry must not shut down the subagent.
- A queued child result must arrive before the final shutdown decision.
- An exhausted provider error must still write an error sidecar before shutdown.
- An aborted final assistant message must keep the session open.
- A pending `ask_question` must remain waiting even after a low-level run ends.

---

### Task 1: Update the development environment to Pi 0.87.0

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: Exact Pi 0.87.0 development runtime used by all later tests.

- [ ] **Step 1: Create an isolated feature branch**

```bash
cd ~/.pi/agent/git/github.com/max-miller1204/pi-interactive-subagents
git status --short --branch
git switch -c feat/pi-087-lifecycle
```

Expected: clean branch from current `main`.

- [ ] **Step 2: Update exact Pi packages**

```bash
npm install --save-dev --save-exact \
  @earendil-works/pi-coding-agent@0.87.0 \
  @earendil-works/pi-server@0.87.0 \
  @earendil-works/pi-tui@0.87.0
```

- [ ] **Step 3: Verify version alignment**

```bash
npm run check:pi-versions
node -e 'const p=require("./package-lock.json"); for (const n of ["@earendil-works/pi-coding-agent","@earendil-works/pi-server","@earendil-works/pi-tui"]) console.log(n,p.packages[`node_modules/${n}`]?.version)'
```

Expected: every printed Pi version is `0.87.0`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: test subagents against Pi 0.87"
```

### Task 2: Define final-boundary activity transitions

**Files:**
- Modify: `pi-extension/subagents/activity.ts`
- Modify: `test/test.ts`

**Interfaces:**
- Produces: `agentBeforeSettleWaiting(): void` and `agentBeforeSettleDone(): void` on `SubagentActivityRecorder`.
- Preserves: `agentEndWaiting(): void` as a low-level run-end record.

- [ ] **Step 1: Write failing recorder tests**

Add tests that assert:

```ts
recorder.agentEndWaiting();
let snapshot = readSubagentActivityFile(file, childId);
assert.equal(snapshot.ok && snapshot.activity.latestEvent, "agent_end");
assert.equal(snapshot.ok && snapshot.activity.phase, "waiting");

recorder.agentBeforeSettleDone();
snapshot = readSubagentActivityFile(file, childId);
assert.equal(snapshot.ok && snapshot.activity.latestEvent, "agent_before_settle");
assert.equal(snapshot.ok && snapshot.activity.phase, "done");
```

Add a waiting variant that records `agent_before_settle` with phase `waiting` and does not disable later recording.

- [ ] **Step 2: Run the focused test and confirm failure**

```bash
npm test -- --test-name-pattern='agent_before_settle|activity recorder'
```

Expected: FAIL because the event and methods do not exist.

- [ ] **Step 3: Extend the activity model**

Add `"agent_before_settle"` to `SubagentActivityEvent` and `KNOWN_EVENTS`.

Add recorder methods:

```ts
agentBeforeSettleWaiting(): void;
agentBeforeSettleDone(): void;
```

Implement them with:

```ts
agentBeforeSettleWaiting() {
  record("agent_before_settle", (current, observedAt) => {
    clearActiveState(current);
    current.phase = "waiting";
    current.waitingSince = observedAt;
  }, "immediate");
},
agentBeforeSettleDone() {
  markDone("agent_before_settle");
},
```

Add no-op implementations to `createNoopRecorder()`.

- [ ] **Step 4: Run focused tests**

```bash
npm test -- --test-name-pattern='agent_before_settle|activity recorder'
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pi-extension/subagents/activity.ts test/test.ts
git commit -m "feat: record final subagent settlement"
```

### Task 3: Move auto-exit to `agent_before_settle`

**Files:**
- Modify: `pi-extension/subagents/subagent-done.ts`
- Modify: `test/test.ts`

**Interfaces:**
- Consumes: `AgentBeforeSettleEvent.context.contextMessages` and Task 2 recorder methods.
- Produces: `shouldAutoExitBeforeSettle(messages: any[] | undefined): boolean` and final-boundary shutdown handling.

- [ ] **Step 1: Update the extension test harness**

Make `emit()` return handler results so actionable boundaries can be inspected:

```ts
const emit = async (event: string, ...args: any[]) => {
  const results = [];
  for (const handler of handlers.get(event) ?? []) results.push(await handler(...args));
  return results;
};
```

Define a final-boundary event helper:

```ts
const beforeSettle = (messages: any[]) => ({
  type: "agent_before_settle",
  entries: [],
  continue: false,
  outcome: "completed",
  context: { contextMessages: messages, contextEntries: [], llmMessages: [], pendingMessages: [], canContinue: false },
});
```

- [ ] **Step 2: Write failing lifecycle tests**

Convert existing auto-exit tests so `agent_end` never shuts down and `agent_before_settle` makes the decision.

Add this retry regression:

```ts
it("does not shut down at a low-level agent_end before retry", async () => {
  let shutdown = false;
  await emit("agent_end", { messages: [{ role: "assistant", stopReason: "error" }] }, { shutdown() { shutdown = true; } });
  assert.equal(shutdown, false);

  await emit("agent_start");
  await emit("agent_before_settle", beforeSettle([
    { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "done" }] },
  ]), { shutdown() { shutdown = true; } });
  assert.equal(shutdown, true);
});
```

Also test pending question, running child, aborted response, and final error sidecar at `agent_before_settle`.

- [ ] **Step 3: Run the focused test and confirm failure**

```bash
npm test -- --test-name-pattern='agent_before_settle|low-level agent_end|pending question'
```

Expected: FAIL because shutdown still happens in `agent_end`.

- [ ] **Step 4: Keep `agent_end` notification-only**

Replace the current decision block with:

```ts
pi.on("agent_end", () => {
  recorder.agentEndWaiting();
});
```

Do not call `ctx.shutdown()` or write an error sidecar in this handler.

- [ ] **Step 5: Add the final-boundary handler**

Register:

```ts
pi.on("agent_before_settle", (event, ctx) => {
  const messages = event.context.contextMessages as any[];
  const hasPendingChildren = runningChildrenCount() > 0;
  const shouldExit =
    event.outcome !== "aborted" &&
    !awaitingAnswer &&
    !hasPendingChildren &&
    autoExit &&
    shouldAutoExitBeforeSettle(messages);

  if (!shouldExit) {
    recorder.agentBeforeSettleWaiting();
    if (autoExit) userTookOver = false;
    return;
  }

  const errorInfo = findLatestAssistantError(messages);
  const sessionFile = process.env.PI_SUBAGENT_SESSION;
  if (errorInfo && sessionFile) {
    writeFileSync(
      `${sessionFile}.exit`,
      JSON.stringify({
        type: "error",
        errorMessage: errorInfo.errorMessage,
        stopReason: errorInfo.stopReason,
      }),
    );
  }
  recorder.agentBeforeSettleDone();
  ctx.shutdown();
});
```

Rename `shouldAutoExitOnAgentEnd` to `shouldAutoExitBeforeSettle`. Remove its unused `_userTookOver` parameter. Preserve abort and error rules.

- [ ] **Step 6: Run focused and complete unit tests**

```bash
npm test -- --test-name-pattern='agent_before_settle|low-level agent_end|pending question|error sidecar'
npm test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add pi-extension/subagents/subagent-done.ts test/test.ts
git commit -m "fix: auto-exit subagents after final settlement"
```

### Task 4: Verify Pi 0.87 integration behavior

**Files:**
- Modify only if a failing test identifies a specific incompatibility.
- Test: `test/integration/subagent-lifecycle.test.ts`

**Interfaces:**
- Consumes: Pi 0.87 runtime and final-boundary extension behavior.
- Produces: Evidence that real subagent processes exit, park, and resume correctly.

- [ ] **Step 1: Add an integration assertion for the final boundary**

Extend the lifecycle integration fixture to assert that a normal auto-exit child's final activity snapshot has `latestEvent: "agent_before_settle"` and `phase: "done"` before process exit. Unit tests own the event-order assertion because the activity file stores only its latest event.

- [ ] **Step 2: Run the lifecycle integration test**

```bash
npm run test:integration -- --test-name-pattern='lifecycle|auto-exit'
```

Expected: PASS under Pi 0.87.0.

- [ ] **Step 3: Run all integration tests**

```bash
npm run test:integration
```

Expected: PASS with no stranded tmux sessions.

- [ ] **Step 4: Commit integration coverage**

```bash
git add test/integration/subagent-lifecycle.test.ts
git commit -m "test: verify Pi 0.87 subagent settlement"
```

### Task 5: Update documentation and complete verification

**Files:**
- Modify: `README.md`
- Modify comments: `pi-extension/subagents/subagent-done.ts`

**Interfaces:**
- Produces: Documentation that names `agent_before_settle` as the auto-exit boundary.

- [ ] **Step 1: Update stale lifecycle text**

Replace statements that auto-exit happens when `agent_end` fires. Explain that Pi retries and queued continuations finish before the final decision.

- [ ] **Step 2: Run final verification**

```bash
npm ci
npm run check:pi-versions
npm test
npm run test:integration
git diff --check
git status --short
git log --oneline --decorate -6
```

Expected: all commands pass and the branch contains only scoped changes.

- [ ] **Step 3: Commit documentation**

```bash
git add README.md pi-extension/subagents/subagent-done.ts
git commit -m "docs: describe final subagent lifecycle boundary"
```
