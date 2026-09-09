---
name: iterative-review
description: Routes independent branch review requests to the reviewer subagent. Only that subagent runs the bounded review, fix, test, and fresh-rereview loop and prepares the PR handoff.
---

# Iterative Review

Review the complete feature-branch change. Fix verified defects in bounded rounds. Use a new independent reviewer for each pass. Hand the result to the reviewed PR skill only after the exact final revision passes.

## Execution owner

Only the `reviewer` subagent profile executes this workflow. If you are the main session or another agent:

1. Delegate to `reviewer` with the repository root as `cwd`.
2. Pass the exact task, purpose, constraints, known branch and base, and any prior review evidence. Preserve the requested review-only mode, repair limits, user decisions, and restrictions on edits, commits, or publication. Do not add authorization that the user did not give.
3. Stop executing this skill in your session. Do not run the review loop, start its independent review helpers, or perform its repairs and certification yourself.
4. Wait for the delivered result without polling. Relay questions and explicit user decisions to the same `reviewer` session. Do not change the reviewed worktree while it runs.
5. If delegation is unavailable, report `blocked`. Do not substitute another agent or run the loop locally.

The sections below are instructions for `reviewer` only. The reviewer follows them directly; it must not delegate this workflow to another reviewer.

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
- `accepted-with-findings`: A fresh full review is complete. The user explicitly accepted each named remaining finding. All required checks pass. The reviewed revision is still the current `HEAD`.
- `review-only`: The user requested findings but did not authorize edits.

Only `satisfied` and `accepted-with-findings` can enter the PR handoff. Never describe an exhausted or blocked run as satisfactory or as having no mistakes.

## 1. Preflight

Determine the mode before any repository operation. If the user requests findings without changes, use review-only mode. Otherwise, review-and-fix is the default, subject to the user's restrictions. Publication is never implied by either mode.

In review-only mode, do not edit, stage, commit, fetch, create worktrees, run tests, builds, formatters, or generators, or push or change a pull request. Use read-only inspection only. The reviewed scope is the committed merge-base-to-target delta; staged, unstaged, and untracked changes are not included.

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
5. Require a clean worktree for review-and-fix mode. If tracked or untracked changes exist, ask whether they belong to this review. In review-only mode, disclose those excluded changes and confirm that a committed-only review is acceptable before proceeding. If the user needs uncommitted changes reviewed, use `blocked` and explain that this workflow requires a committed target. Do not stash, reset, clean, discard, or commit user work to make it fit this workflow.
6. Determine the change purpose from the task, linked issue, or existing pull request. Preserve explicit constraints and exclusions. Ask if product intent is materially ambiguous.
7. Determine the base in this order:
   - a base explicitly supplied by the user;
   - the base of the existing pull request;
   - the tracked remote default branch;
   - the local default branch.
8. In review-and-fix mode, fetch the selected remote base when it is safe and available. In review-only mode, use local Git objects and report that the remote base was not refreshed. If required objects are unavailable, use `blocked`; do not fetch them. Do not rebase or merge. Record the base ref, base tip, and merge-base SHA. The review range starts at the merge base.

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
- user-facing validation scenarios and their observed results;
- reviewer-visible evidence artifacts and their labels;
- commits created by this workflow.

## 3. Run one fresh full review

Use a new independent review session for every full pass, including retries. Follow the helper launch instructions in the `reviewer` profile. Never reuse a previous review session to certify fixes.

Give it:

- the exact change purpose and constraints;
- base ref, base tip, merge-base SHA, and target `HEAD` SHA;
- the complete finding ledger;
- the list of commits made by prior fix rounds;
- an instruction to perform one full base-to-target review and return the required JSON;
- the review mode and excluded uncommitted paths. When the worktree is dirty, require committed-file inspection at the recorded SHAs, not working-tree contents, for source evidence.

Do not poll the subagent. Wait for its delivered result. Validate the complete independent review output contract, not only JSON syntax. Require `review_status` (`complete` or `blocked`), both reviewed SHA fields, and the `findings`, `notes`, and `blockers` arrays. A complete pass must have two verified full SHAs and no blockers. A blocked pass must have at least one blocker; an unverified SHA must be `null`. If the JSON is missing or invalid, request one new independent pass and retry once. If the second result is invalid, use `blocked`.

If `review_status` is `blocked`, keep its verified findings and blockers visible and use the workflow state `blocked`. Do not mark prior findings fixed, start repairs, or enter the PR handoff from a partial review. After the blocker is resolved, run a new fresh full review.

For a complete pass, confirm that `reviewed_base_sha` equals the requested merge-base SHA and `reviewed_head_sha` equals the requested target SHA. Use `blocked` for a mismatch. An empty `findings` array or matching SHAs cannot certify an incomplete review.

Merge the result into the ledger:

- Reuse an ID when the same invariant remains broken.
- Add an ID only for a different defect.
- Mark a prior item `fixed` only after independent verification.
- Keep non-blocking notes outside the actionable finding list.

### Review-only exit

After a complete, valid full review in review-only mode, return `review-only` and stop. Report the reviewed base and target SHAs, findings, notes, excluded uncommitted changes, and the local-base limitation. State that project checks were not run and that no certification or PR handoff was produced. Return `blocked` instead if the review could not finish.

Do not continue to triage, repair rounds, project checks, certification, or PR drafting. A request to fix findings starts a separate review-and-fix run with new preflight checks and explicit user restrictions preserved.

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

If the user accepts the finding without a fix, record its exact ID as `accepted`. Do not silently downgrade its severity or remove a remaining defect from the review result. Acceptance applies only to that finding as presented. It does not waive review completion, project checks, or final revision checks. If all remaining findings are accepted and no repair is needed, proceed to project checks, not directly to the PR handoff.

### Branch causality

A finding can block this branch only when the branch introduced, activated, or worsened the problem, or when the stated scope directly requires the invariant. An unrelated pre-existing defect is a note or follow-up. Inspection can extend beyond changed lines, but blocking scope cannot expand into a repository-wide audit without user approval.

## 5. Apply one fix round

Before each repair batch:

1. Check the current fix-round count.
2. If the limit is reached, follow the "Round exhaustion" section below in this file.
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

After a fresh full review is complete, run this step when its findings are empty or every remaining finding has explicit user acceptance. Discover the applicable commands from repository instructions, CI workflows, package metadata, and existing scripts. Both `satisfied` and `accepted-with-findings` require these checks.

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

Build a short list of validation scenarios from the change purpose. Each scenario must name one user action or semantic validation step and one observable result. Keep the list proportionate to the branch.

Exercise each scenario through the real product or another public interface when feasible. Record whether it passed, failed, or was not tested. Mark it as live only when you drove the real product in this run. A unit test, mock, fixture, or source inspection is not live evidence. If you cannot exercise a scenario, record the exact limitation. Never infer a pass.

Collect reviewer-visible evidence when it helps demonstrate the result. Prefer screenshots, rendered output, CLI transcripts, API responses, persisted state, or short logs that directly show the changed behavior. A generic test pass, coverage report, or clean-worktree output is not product evidence. Keep each artifact outside the reviewed worktree unless it is an intentional branch file. Do not commit generated evidence files.

For web-facing changes, use the `playwright-cli` workflow to verify the real user flow. Check console errors and failed network requests. Capture visual evidence for a visible change when the environment supports it. Do not claim visible behavior works without browser verification. Record why visual evidence is unavailable when a required tool, permission, or product surface is missing.

If a check fails because of this branch, fix it as another bounded fix round. If a formatter or generator changes files, treat those changes as a repair batch and rereview the complete branch after the commit. If a failure is pre-existing or environmental, prove that distinction and use `blocked` when it prevents certification.

## 7. Certify the exact revision

Before `satisfied` or `accepted-with-findings`:

1. Fetch the base ref again when available.
2. If the merge base changed, run a new fresh full review against the updated merge base. This review does not consume a fix round unless it causes a repair.
3. Confirm that the latest fresh full review has `review_status: complete`, no blockers, and matching merge-base and head SHAs. For `satisfied`, its `findings` array must be empty. For `accepted-with-findings`, every remaining finding must match an explicit user acceptance in the ledger. A new or changed finding needs a new decision; acceptance of an earlier finding does not cover it.
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

Only after project checks and final certification pass, create this handoff for `satisfied` or `accepted-with-findings` in working context. Put the complete latest independent review JSON object in `review`. Keep accepted defects in its `findings` array and record their IDs and user acceptance evidence in `accepted_findings`.

```json
{
  "status": "satisfied or accepted-with-findings",
  "base_ref": "remote/base",
  "base_sha": "merge-base SHA",
  "head_sha": "reviewed HEAD SHA",
  "review": {
    "review_status": "complete",
    "reviewed_base_sha": "merge-base SHA",
    "reviewed_head_sha": "reviewed HEAD SHA",
    "findings": [],
    "notes": [],
    "blockers": []
  },
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
  "evidence": {
    "summary": "Concise statement of what the evidence demonstrates.",
    "scenarios": [
      {
        "name": "User action or semantic validation",
        "result": "passed, failed, or untested",
        "live": true,
        "observation": "Observable result or exact limitation.",
        "finding_ids": [],
        "artifact_labels": []
      }
    ],
    "artifacts": [
      {
        "kind": "screenshot, video, command-output, log, or other",
        "label": "Reviewer-facing label",
        "url": "optional remotely reachable URL",
        "content": "optional short text shown in the PR"
      }
    ],
    "limitations": []
  },
  "accepted_findings": []
}
```

For each failed scenario, use `finding_ids` to identify the current findings that account for every observed failure. Keep its result `failed` even when the user accepted those findings. Only explicit acceptance of all mapped failures permits an `accepted-with-findings` handoff. Acceptance does not waive required project checks.

Derive `what_changed` from the final diff. Do not use the user's motivation as a change summary. Include only reproduction, test, scenario, and artifact claims that were verified. Do not put secrets, machine-local paths, or unverified evidence URLs in the handoff.

Then read and follow [`../reviewed-pr/SKILL.md`](../reviewed-pr/SKILL.md). Pass the complete handoff to that workflow. If publication was not explicitly authorized, prepare the title and body, then ask before any push or pull-request mutation.

## Final response

Report:

- final state;
- base and reviewed head;
- number of full review passes and fix rounds;
- findings fixed and findings explicitly accepted;
- exact checks and outcomes;
- validation scenarios and evidence limitations;
- commits created;
- PR title/body draft or PR URL;
- blockers or unresolved findings.
