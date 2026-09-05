---
name: iterative-review
description: Runs a bounded review, fix, test, and fresh-rereview loop on a checked-out feature branch. Use for the reviewer subagent or when a user asks for an independent code review that can repair findings and prepare a pull request.
---

# Iterative Review

Review the complete feature-branch change. Fix verified defects in bounded rounds. Use a new independent reviewer for each pass. Hand the result to the reviewed PR skill only after the exact final revision passes.

## Defaults

Use these defaults unless the user supplies a smaller positive limit:

```yaml
review:
  max_fix_rounds: 3
  rereview_scope: full
  block_severity: warning
  auto_fix_ask_user: false
  require_fresh_reviewer: true
```

`max_fix_rounds` counts all repair batches. It includes repairs requested by the agent or user. Never use an unlimited round count. One batch can fix multiple findings.

## Final states

Use exactly one final state:

- `satisfied`: A fresh full review has no actionable findings. All required checks pass. The reviewed revision is still the current `HEAD`.
- `fix-rounds-exhausted`: The fix-round limit was reached and findings remain. Park and ask the user what to do.
- `blocked`: The environment, tests, repository state, missing context, or publication state prevents safe completion.
- `accepted-with-findings`: The user explicitly accepted each named remaining finding.
- `review-only`: The user requested findings but did not authorize edits.

Only `satisfied` and `accepted-with-findings` can enter the PR handoff. Never describe an exhausted or blocked run as satisfactory or as having no mistakes.

## 1. Preflight

1. Resolve the repository root with Git.
2. Read all applicable repository instruction files.
3. Record these values before any edit:
   - branch name;
   - `HEAD` SHA;
   - `git status --short`;
   - remotes and branch upstream;
   - default branch;
   - existing pull request title, body, base, head, and URL when one exists.
4. Refuse detached `HEAD` and the default branch. Ask the orchestrator for a feature branch.
5. Require a clean worktree for review-and-fix mode. If tracked or untracked changes exist, ask whether they belong to this review. Do not stash, reset, clean, or discard them.
6. Determine the change purpose from the task, linked issue, or existing pull request. Preserve explicit constraints and exclusions. Ask if product intent is materially ambiguous.
7. Determine the base in this order:
   - a base explicitly supplied by the user;
   - the base of the existing pull request;
   - the tracked remote default branch;
   - the local default branch.
8. Fetch the selected remote base when it is safe and available. Do not rebase or merge. Record the base ref, base tip, and merge-base SHA. The review range starts at the merge base.
9. Detect review-only mode from the task. Otherwise, review-and-fix is the default. Publication is never implied by review-and-fix.

If the repository or branch relationship is ambiguous, use `blocked` instead of guessing.

## 2. Build the initial ledger

Keep a finding ledger in working context. Each item must contain:

- stable finding ID;
- status: `open`, `fixed`, `accepted`, `rejected`, or `superseded`;
- severity and action;
- file and line;
- invariant and concrete sequence;
- causality;
- fix round;
- verification evidence.

Prior findings are claims, not evidence. Never mark a finding fixed until source inspection and a targeted check support that result.

Also keep:

- exact commands and outcomes;
- manual verification steps and observations;
- reproduction steps for the old behavior when feasible;
- expected behavior on the reviewed branch;
- commits created by this workflow.

## 3. Run one fresh full review

For every pass, spawn a new `review-pass` subagent. Use a new name such as `review-pass-round-0`, `review-pass-round-1`, and so on. Start it in the repository root.

The `review-pass` profile is intentionally hidden from `subagents_list`. Its absence from that list is expected. Spawn it directly with the exact agent name `review-pass`. Do not ask the user to expose it or provide its profile.

Give it:

- the exact change purpose and constraints;
- base ref, base tip, merge-base SHA, and target `HEAD` SHA;
- the complete finding ledger;
- the list of commits made by prior fix rounds;
- an instruction to perform one full base-to-target review and return the required JSON.

Do not poll the subagent. Wait for its delivered result. If its JSON is missing or invalid, spawn one new pass and retry once. If the second result is invalid, use `blocked`.

Confirm that `reviewed_base_sha` and `reviewed_head_sha` match the requested SHAs. A review of another revision cannot certify the branch.

Merge the result into the ledger:

- Reuse an ID when the same invariant remains broken.
- Add an ID only for a different defect.
- Mark a prior item `fixed` only after independent verification.
- Keep non-blocking notes outside the actionable finding list.

## 4. Triage findings

Verify each finding before you edit.

### Auto-fix

An `auto-fix` finding can be repaired without user input only when the smallest remedy:

- restores objective correctness, security, privacy, reliability, compatibility, or performance;
- does not change intended product behavior;
- does not add a subsystem, durable state, persistence model, background process, retry policy, compatibility mode, or new user-visible option.

Group compatible findings into one small repair batch.

### Ask-user

Do not fix an `ask-user` finding without approval. Relay the full finding to the orchestrator and ask one question. This includes a remedy that changes product behavior or extends the requested design.

If the user accepts the finding without a fix, record its exact ID as `accepted`. Do not silently downgrade its severity.

### Branch causality

A finding can block this branch only when the branch introduced, activated, or worsened the problem, or when the stated scope directly requires the invariant. An unrelated pre-existing defect is a note or follow-up. Inspection can extend beyond changed lines, but blocking scope cannot expand into a repository-wide audit without user approval.

## 5. Apply one fix round

Before each repair batch:

1. Check the current fix-round count.
2. If the limit is reached, go to [Round exhaustion](#round-exhaustion).
3. Ask whether the proposed fix adds new machinery. If it does, request user approval or replace it with a smaller correction.
4. Recheck `git status --short` and confirm that no external change appeared.

Apply the smallest root-cause fix. Do not perform unrelated cleanup. Inspect all callers that rely on the corrected boundary.

For a regression, reproduce the reported failure before the fix when feasible. Use a temporary worktree at the merge base when the current branch already contains the fix. Never reset or alter the checked-out feature branch to demonstrate old behavior.

### Test-quality rule

Tests must execute a public or executable interface and assert observable behavior, state, output, side effects, or failure modes.

Do not add a test whose only evidence is that it reads, greps, parses, or snapshots implementation source and finds a string, token, function name, prompt phrase, regular expression, AST shape, or incidental snapshot. Such a test does not prove behavior.

For declarative files, use the real consumer when feasible. Otherwise, parse the file into a normalized semantic model and assert its meaning. Reading a file is valid only when the file itself is the public output, serialized protocol, persisted state, or other explicit text contract.

Run focused checks for the repair. Review the resulting diff. Stage only files from the repair batch. Commit them without amending or rewriting existing commits. Use a concise subject such as:

```text
fix(review): correct <specific invariant>
```

Record the commit SHA. Increment the fix-round count once for the batch. Then run a new fresh full review.

## 6. Run project checks

When a fresh review returns no actionable findings, discover the applicable commands from repository instructions, CI workflows, package metadata, and existing scripts.

Run the relevant checks, which can include:

- focused regression tests;
- full tests;
- lint;
- formatting checks;
- type checks;
- builds;
- documentation generation or validation;
- executable integration tests.

Do not claim a command passed unless you ran it and observed success. Record the exact command, environment detail that matters, and result.

For web-facing changes, use the `playwright-cli` workflow to verify the real user flow. Check console errors and failed network requests. Do not claim visible behavior works without browser verification. Do not commit screenshots, traces, videos, or generated browser state unless the user requests them.

If a check fails because of this branch, fix it as another bounded fix round. If a formatter or generator changes files, treat those changes as a repair batch and rereview the complete branch after the commit. If a failure is pre-existing or environmental, prove that distinction and use `blocked` when it prevents certification.

## 7. Certify the exact revision

Before `satisfied`:

1. Fetch the base ref again when available.
2. If the merge base changed, run a new fresh full review against the updated merge base. This review does not consume a fix round unless it causes a repair.
3. Confirm that the latest fresh full review has an empty actionable `findings` array.
4. Confirm that all required checks passed on the current code.
5. Confirm that `git status --short` is clean.
6. Confirm that current `HEAD` equals the last reviewed head.
7. Confirm that no external commit or file change appeared during the workflow.

If any file or commit changes after the final review, the certification is invalid. Run the required checks and a new fresh full review.

## Round exhaustion

When the fix-round limit is reached, keep all findings visible and use `fix-rounds-exhausted`. Do not approve, skip, downgrade, or publish automatically.

Ask the user to choose one action:

- stop and keep the branch;
- authorize exactly one additional fix round;
- accept specific finding IDs;
- change the requested scope.

An extra round is bounded to one. It does not reset the original budget. If findings remain after it, park again.

## PR handoff

For `satisfied` or `accepted-with-findings`, create this handoff in working context:

```json
{
  "status": "satisfied or accepted-with-findings",
  "base_ref": "remote/base",
  "base_sha": "merge-base SHA",
  "head_sha": "reviewed HEAD SHA",
  "fix_rounds": 0,
  "review_commits": [],
  "what_changed": [],
  "reproduction": {
    "kind": "bug, feature, or other",
    "prerequisites": [],
    "before": [],
    "on_branch": [],
    "expected": []
  },
  "tests": [
    {"command": "exact command", "result": "passed", "notes": ""}
  ],
  "accepted_findings": []
}
```

Derive `what_changed` from the final diff. Do not use the user's motivation as a change summary. Include only reproduction and test claims that were verified.

Then read and follow [`../reviewed-pr/SKILL.md`](../reviewed-pr/SKILL.md). Pass the complete handoff to that workflow. If publication was not explicitly authorized, prepare the title and body, then ask before any push or pull-request mutation.

## Final response

Report:

- final state;
- base and reviewed head;
- number of full review passes and fix rounds;
- findings fixed and findings explicitly accepted;
- exact checks and outcomes;
- commits created;
- PR title/body draft or PR URL;
- blockers or unresolved findings.
