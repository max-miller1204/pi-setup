# Pi 0.87 Extension Coordination Design

## Purpose

Update Max Miller's Pi extensions and setup for Pi 0.87.0.

The work has four goals:

1. Make interactive subagent shutdown use the final actionable lifecycle boundary.
2. Make observational-memory compaction wait for active memory workers.
3. Remove covered retained source messages from future model context after successful compaction.
4. Make `pi-setup` reproduce the current active local setup while preserving dormant review resources.

This work must keep normal agent turns responsive. Memory workers must remain asynchronous unless compaction needs their output.

## Repositories

The work affects these repositories:

- `~/pi-observational-memory`
- `~/.pi/agent/git/github.com/max-miller1204/pi-interactive-subagents`
- `~/pi-session-tasks`
- `~/pi-setup`

The observational-memory fork package locator is:

```text
git:github.com/max-miller1204/pi-observational-memory
```

The existing `fix/pi-087-finish-turn` branch in the fork must merge into the fork's `master` before new observational-memory work starts. The new work must not reimplement that migration. Observational-memory development dependencies and its lockfile must then use Pi 0.87.0 so the new APIs are type-checked.

## Constraints

- Use Pi 0.87.0 APIs.
- Do not modify `pi-mcp-adapter` or `pi-web-access`.
- Do not delay ordinary model turns for observational-memory workers.
- Do not mutate `ReadonlySessionManager` through a type cast.
- Do not add compatibility fallbacks.
- Fail loudly when an invariant is not met.
- Preserve raw session history and branch behavior.
- Keep dormant setup resources in Git, but do not install or load them.
- Follow each repository's existing test and formatting rules.

## Architecture

### Lifecycle boundaries

Pi 0.87.0 adds `agent_before_settle` and actionable `turn_end` boundaries.

Use each boundary for one purpose:

- `agent_end` records low-level run activity only.
- `agent_before_settle` decides whether an auto-exit subagent can shut down.
- `turn_end` adds pending append-only context edits after a successful compaction.
- `agent_settled` requests proactive compaction after memory workers finish.
- `session_before_compact` waits for memory workers before it builds the compaction payload.
- `session_compact` marks a successful compaction as eligible for later context cleanup.

No handler returns `continue: true` for this work.

### Ordering

The normal ordering is:

```text
turn_end
  -> start due memory workers in the background
  -> normal Pi work continues

agent_settled
  -> detect proactive compaction threshold
  -> await active memory workers
  -> re-read branch and threshold state
  -> request ctx.compact()

session_before_compact
  -> await active memory workers as a safety gate
  -> re-read the current branch
  -> build the compaction projection from current memory records

session_compact
  -> record that cleanup can be derived from the successful compaction

next turn_end
  -> derive covered retained source entries
  -> return context_edit drafts with replacement: null
```

Manual and Pi-native compaction enter at `session_before_compact`. They receive the same worker wait guarantee.

## Observational Memory

### Worker-aware compaction

`Runtime.consolidationPromise` remains the source of truth for active observer, reflector, and dropper work.

`session_before_compact` must:

1. Await `runtime.consolidationPromise` when it is not null.
2. Re-read `ctx.sessionManager.getBranch()` after the wait.
3. Build the memory projection from this fresh branch.
4. Keep the prepared `firstKeptEntryId` and `tokensBefore` supplied by Pi.
5. Continue to delegate to Pi's native summarizer when the memory projection is empty.

The handler must not use the stale `event.branchEntries` snapshot after it waits.

### Settled compaction scheduling

Remove the `setTimeout(..., 0)` workaround from the proactive compaction trigger.

The `agent_settled` handler must:

1. Confirm passive mode is disabled.
2. Confirm no compaction is already active.
3. Check the source-token threshold.
4. Mark proactive compaction as pending.
5. Await an active consolidation worker.
6. Confirm the context is still idle.
7. Re-read the branch.
8. Recalculate the threshold.
9. Skip the request if another compaction already reset progress.
10. Call `ctx.compact()` directly.
11. Clear state through completion, error, and synchronous exception paths.

Pi 0.87.0 defers work requested from `agent_settled` until all settled handlers finish. The extension must rely on this behavior instead of a timer.

### Append-only context cleanup

Cleanup applies only after a successful compaction.

The extension must derive cleanup from committed branch state. It must not depend only on transient in-memory flags. This lets cleanup survive reload and resume.

At a later `turn_end`, the extension must:

1. Find the latest successful compaction on the active branch.
2. Find the latest confirmed observation coverage marker at or before that compaction entry.
3. Identify source message entries that:
   - are retained in the post-compaction model projection;
   - are at or before the confirmed coverage boundary;
   - can legally be targeted by `context_edit`;
   - are not already omitted by a later context edit.
4. Append one `context_edit` draft per target with `replacement: null`.
5. Preserve `event.entries` and append drafts in source order.
6. Return no continuation request.

The cleanup must not target:

- system messages;
- custom memory ledger entries;
- unobserved source messages;
- messages already excluded by compaction;
- messages already omitted by an active later context edit;
- entries on another branch.

The original session entries remain available in raw history, exports, UI history, and observational-memory recall.

A successful idle compaction can have one later provider response before cleanup is committed. This is the cost of using supported actionable boundaries without mutating `ReadonlySessionManager`.

### Structural updates at `turn_end`

The cleanup handler uses the Pi 0.87.0 boundary result:

```ts
return {
  entries: [...event.entries, ...contextEditDrafts],
};
```

It must not call `pi.appendEntry()` for context edits. It must not call mutable `SessionManager` methods through a cast.

Existing background workers can continue to append observational-memory custom ledger entries through the extension API. They do not become synchronous `turn_end` drafts.

### Tests

Add focused tests for:

- compaction waiting for an active worker;
- rebuilding from the branch after the worker finishes;
- ignoring stale `event.branchEntries` after a wait;
- direct `ctx.compact()` scheduling without `setTimeout`;
- threshold recheck after waiting;
- duplicate compaction prevention;
- cleanup only after successful compaction;
- cleanup of covered retained source entries;
- no cleanup of unobserved or excluded entries;
- duplicate edit prevention;
- branch-local cleanup;
- no `continue: true` result;
- state cleanup after errors and aborts.

Run the complete observational-memory typecheck and test suite.

## Interactive Subagents

### Final shutdown boundary

Move auto-exit decisions from `agent_end` to `agent_before_settle`.

`agent_end` must continue to record low-level activity. It must not request shutdown.

`agent_before_settle` must decide whether to shut down only after Pi has completed retries, automatic recovery, compaction, and queued continuation handling.

The handler must preserve current behavior for:

- `ask_question` sessions that are waiting for an answer;
- workers with running child subagents;
- user aborts;
- exhausted provider errors;
- automatic exit after a normal final response;
- error sidecar creation;
- activity state transitions.

Use `event.context.contextMessages` to inspect the final projected assistant result. Do not depend on the earlier `agent_end.messages` snapshot for the shutdown decision.

`ctx.shutdown()` remains the shutdown mechanism. Pi defers it until the session becomes idle.

### Activity reporting

Add `agent_before_settle` to activity types and recording if the activity model needs to distinguish final settlement from low-level `agent_end`.

Keep `agent_end` records for diagnostics. Mark a subagent done only when the final boundary accepts auto-exit.

### Pi 0.87 dependency update

Update development dependencies from Pi 0.85.0 to Pi 0.87.0. Keep related Pi packages on one exact version.

Refresh the lockfile and run:

```bash
npm run check:pi-versions
npm test
npm run test:integration
```

A worker subagent will implement and test this repository.

## Session Tasks

Refresh `~/pi-session-tasks/package-lock.json` so the development environment resolves Pi 0.87.0.

Keep the published peer dependencies broad. They describe runtime package hosting, while the lockfile defines the tested development version.

Run:

```bash
npm run check
```

No behavior change is required unless Pi 0.87.0 type checking or tests expose one.

## Pi Setup

### Active package list

Make the setup package list match the current intended local setup:

```json
[
  "npm:pi-web-access",
  "git:github.com/max-miller1204/pi-observational-memory",
  "npm:pi-mcp-adapter",
  "git:github.com/max-miller1204/pi-interactive-subagents",
  "git:github.com/max-miller1204/pi-setup",
  "git:github.com/obra/superpowers",
  "git:github.com/max-miller1204/pi-session-tasks"
]
```

Remove `npm:stepstone`.

Add the portable local preference:

```json
{
  "externalEditor": "nvim"
}
```

Keep the existing model, theme, observational-memory, fullscreen, thinking, and Markdown settings.

### Dormant resources

Create repository-only dormant directories:

```text
dormant/
  agents/
    reviewer.md
    review-pass.md
  extensions/
    read-only-git.ts
  skills/
    iterative-review/
    reviewed-pr/
```

Move the existing files. Do not copy them.

The active resource directories must contain:

```text
agents/
  browser-worker.md
  researcher.md
  scout.md
  worker.md

extensions/
  ask-user-question.ts
  custom-header.ts

skills/
  # no setup-owned active skill directories
```

The repository can keep an empty `skills/` directory marker if needed. The installer must handle zero active setup-owned skills without expanding a literal unmatched glob.

`package.json` continues to load only `extensions/*.ts`. Dormant extensions must not match this glob.

The installer copies only active `agents/*.md`. It must not copy dormant agents.

The installer must not install dormant skills into `~/.agents/skills/`. It must preserve unrelated external skills, including skills supplied by the superpowers package and Playwright CLI.

### Setup validation

Update installer and smoke tests to prove:

- active packages match the intended list;
- the observational-memory package uses Max Miller's fork;
- session tasks replaces stepstone;
- superpowers is installed;
- dormant agents are not copied;
- dormant extensions are not loaded;
- dormant skills are not copied or discovered;
- dormant source files remain present in the repository;
- repeated installation remains idempotent;
- existing unrelated skills remain unchanged.

Update `README.md`, `docs/setup.md`, and `docs/maintenance.md` to describe active and dormant resources.

Add exact Pi 0.87.0 development dependencies for the coding-agent and TUI APIs while keeping broad runtime peer dependencies. Refresh `package-lock.json` and run:

```bash
npm ci --ignore-scripts
npm run check
npm audit --audit-level=low
```

## Repository and Integration Sequence

Use this order:

1. Merge `fix/pi-087-finish-turn` into the observational-memory fork's `master`.
2. Update observational memory from the new fork `master`.
3. Update interactive subagents in an isolated worker task.
4. Refresh and verify session tasks.
5. Update `pi-setup` only after the three package repositories have verified revisions.
6. Point `pi-setup` at the fork package locator and updated package list.
7. Run all setup checks.
8. Review cross-repository diffs and package references.

Each repository must use its own focused branch and verification evidence. Do not mix unrelated repository history.

## Failure Handling

- Compaction must wait until the active worker pipeline reaches a terminal result.
- A worker failure must surface through the existing observational-memory diagnostics before compaction continues with the last committed memory ledger.
- A changed session or stale context must stop the compaction request loudly.
- Invalid cleanup targets must fail tests and must not be silently omitted by implementation fallbacks.
- A failed dependency refresh must leave the previous lockfile unchanged or produce a visible Git diff for review.
- Setup tests must fail if dormant resources become active.

## Completion Criteria

The work is complete when:

- the fork's `master` contains the existing `finishTurn` migration;
- observational-memory compaction waits for active workers;
- proactive compaction no longer uses `setTimeout`;
- covered retained source messages receive branch-local context edits after successful compaction;
- interactive subagents decide auto-exit at `agent_before_settle`;
- interactive subagents compile and pass tests against Pi 0.87.0;
- session tasks passes its complete checks with a refreshed Pi 0.87.0 lockfile;
- `pi-setup` matches the intended active local setup;
- review resources remain under `dormant/` and are not loaded;
- setup checks and dependency audit pass;
- no changes are made to `pi-mcp-adapter` or `pi-web-access`.
