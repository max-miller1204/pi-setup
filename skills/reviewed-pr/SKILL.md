---
name: reviewed-pr
description: Drafts or publishes a pull request for an independently reviewed branch. Produces a conventional title and a concise body with What Changed, How to reproduce, and Testing sections. Use after iterative-review succeeds or when the user asks for this PR format.
---

# Reviewed Pull Request

Create a reviewer-focused pull request draft from verified branch evidence. Publish or update it only with explicit authorization.

## Required body structure

Use this order:

```markdown
## What Changed

- Concrete change.

## How to reproduce

### Reproduce the issue

1. Exact step.

Expected before this change: Observable result.

### Verify the fix

1. Exact step on the checked-out pull request branch.

Expected: Observable fixed result.

## Testing

- `exact command` - passed
```

Adapt `How to reproduce` to the change type:

- Bug fix: Use `Reproduce the issue` and `Verify the fix` when the old behavior was verified.
- Feature: Use `Verify the feature`. Do not invent an issue.
- Documentation, configuration, refactor, build, or CI change: Use `Validate the change` with the smallest observable command or inspection procedure.

If a real old-behavior reproduction was not available, do not claim that it was run. Give only verified branch steps and state the relevant prerequisite or limitation in that section.

`How to reproduce` teaches a reviewer what to do. `Testing` records what the reviewer agent actually ran. Do not copy a list of test commands into both sections without explaining the observable review flow.

## 1. Validate the handoff

When this skill follows `iterative-review`, require a complete handoff with:

- status `satisfied` or `accepted-with-findings`;
- base ref and merge-base SHA;
- final reviewed `HEAD` SHA;
- complete latest independent review JSON object in `review`;
- concrete change summary;
- reproduction evidence;
- exact test commands and outcomes.

Refuse `blocked`, `fix-rounds-exhausted`, and `review-only` handoffs.

For both permitted states, validate the review output contract. Require `review_status: complete`, no blockers, and reviewed SHAs that match the handoff base and head. Confirm that the recorded checks cover all required project checks and passed on that exact final code. Do not infer completion from an empty findings array or from the handoff status alone. If review evidence or required check evidence is missing, incomplete, or failed, stop and return control to the `reviewer` subagent for `iterative-review`; do not draft or publish from that handoff.

For `satisfied`, the review findings must be empty. For `accepted-with-findings`, confirm that the user explicitly accepted every remaining finding ID and that the finding still matches the accepted description. Do not infer acceptance from silence. Acceptance does not waive review completion, project checks, or final revision checks.

Before drafting:

1. Confirm that this is a Git repository.
2. Confirm that the current branch is not detached and is not the default branch.
3. Confirm that `git status --short` is clean.
4. Confirm that current `HEAD` equals the reviewed handoff SHA.
5. Confirm that all review commits are included in `HEAD`.
6. Read repository instructions and pull request templates.
7. Inspect the complete merge-base-to-`HEAD` diff.
8. Inspect an existing pull request for this branch when one exists.

If the revision changed after review, stop. Return control to the `reviewer` subagent for checks and a new fresh full review. If you are already that reviewer, resume your workflow. Otherwise, send the complete handoff and reason for the return to the same reviewer session when available, or delegate to a new `reviewer`. Do not run the review loop in the main session.

## 2. Draft the title

Use conventional commit format:

```text
type(scope): short description
```

or:

```text
type: short description
```

Valid types are `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, and `revert`.

Rules:

- Use `feat` for a new user-visible capability.
- Use `fix` for a user-visible correction or behavior improvement.
- Use another type only when there is no user-facing behavior change.
- Use a scope only when it is a real, broad package or module in the repository.
- Cover the full branch delta, not only the latest commit.
- Do not copy the raw branch name.
- Do not invent behavior.

## 3. Draft What Changed

Write one to three short bullets. Describe concrete code or behavior changes from the final diff. Do not describe the user's motivation or the review process.

Include important tests or documentation in a bullet only when they are a material part of the branch. Keep detailed commands in `Testing`.

## 4. Draft How to reproduce

Write steps that a reviewer can follow from a checked-out pull request branch.

Each procedure must include:

- prerequisites that are not obvious;
- exact commands or UI actions;
- required setup data;
- the observable expected result;
- cleanup when the procedure creates durable or external state.

Use portable repository-relative commands. Remove local absolute paths, temporary directory names, tokens, credentials, account identifiers, and machine-specific values.

### Bug fixes

When feasible, teach both sides:

1. Reproduce the old issue in a temporary worktree at the recorded merge base.
2. Run the same operation on the pull request branch.
3. State the different observable results.

Do not tell a reviewer to reset, rebase, or modify the checked-out pull request branch to see the old behavior. A temporary worktree is acceptable when its commands are safe and concise.

If the old issue needs unavailable infrastructure, credentials, destructive actions, or private data, provide a safe fixture or focused executable regression instead. State the limitation. Never publish secrets.

### Features

Show how to start the relevant surface, perform the new action, and observe the result. Include browser steps for visible UI behavior. Do not add a `Reproduce the issue` subsection.

### Other changes

Use a semantic validation procedure. For machine-consumed configuration, prefer the real consumer or a normalized parser over raw text matching.

## 5. Draft Testing

List only checks that were actually run on the final reviewed code. Use exact commands and concise outcomes.

Examples:

```markdown
## Testing

- `npm test` - passed
- `npm run typecheck` - passed
- Playwright: created an item, refreshed the page, and confirmed that it persisted; no console or network errors occurred.
```

Do not claim that CI is green unless you queried the current pull request checks and observed that state. Do not add raw logs unless a short excerpt is necessary to understand the result.

## 6. Preserve repository requirements

Read pull request templates before publication. Preserve mandatory checklists or issue references when they apply.

Wrap the generated block in markers:

```markdown
<!-- reviewed-pr:start -->
...
<!-- reviewed-pr:end -->
```

For an existing pull request:

- Replace only the marked block when both markers exist.
- Preserve content outside the markers.
- If markers do not exist, show the proposed replacement and ask before changing the body.
- Do not remove manual issue-closing references, checklists, or reviewer notes without confirmation.

Keep the complete body below the forge limit. Prefer concise instructions over truncated content.

## 7. Publication boundary

Drafting is allowed after a valid handoff. Pushing, creating a pull request, changing its title or body, changing draft state, and adding labels are remote mutations. Perform them only when the user explicitly asked for that action.

If publication is not already authorized, show the title and body and use `ask_question` to ask whether to publish. Ask one question.

Before a push:

1. Confirm again that the worktree is clean and `HEAD` equals the reviewed SHA.
2. Resolve the current branch upstream.
3. If no upstream exists or more than one remote is plausible, ask which remote to use.
4. Use a normal push. Never force-push.
5. Verify that the remote branch points to the reviewed SHA.

Use a temporary body file outside the repository. Use `gh pr create` or `gh pr edit` with `--body-file`. Remove the temporary file when done. Do not pass a multiline body directly in a shell argument.

For a new pull request:

- Create it as a draft unless the user explicitly requests a ready pull request.
- Use the selected base branch and the current feature branch.
- Do not create a duplicate when a pull request already exists for the branch.

For an existing pull request:

- Do not change its draft or ready state unless requested.
- Verify that its base and head branches match the reviewed handoff.
- Update only the authorized title and body.

After publication, query the pull request again. Confirm its URL, title, base, head, draft state, and remote head SHA.

## 8. Final checks and response

Before you present or publish the body, confirm:

- it contains `## What Changed`;
- it contains `## How to reproduce`;
- it contains `## Testing`;
- every behavior claim comes from the final diff;
- every testing claim comes from recorded execution;
- reproduction steps contain expected observable results;
- no secret or machine-local absolute path is present.

Return:

- title;
- complete body or a concise body summary when it was published;
- reviewed base and head SHA;
- publication action: `drafted`, `created`, or `updated`;
- pull request URL when published;
- any limitation in the reproduction procedure.
