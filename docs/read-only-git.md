# Read-only Git inspection (dormant)

This document describes a dormant resource. The extension is preserved at [`dormant/extensions/read-only-git.ts`](../dormant/extensions/read-only-git.ts). Its test is preserved at [`dormant/tests/test-read-only-git.mjs`](../dormant/tests/test-read-only-git.mjs). The active setup does not install or load this extension. The `reviewer` profile is also dormant under `dormant/agents/`.

The dormant `read_only_git` tool was designed to let an independent reviewer inspect committed source without a shell. The dormant reviewer profile lists the tool so the subagent launcher can pass the extension to its helper.

## Operations

Use structured arguments, not a command string:

- `resolve`: Resolve `HEAD` or a full commit SHA.
- `files`: List files in a commit.
- `diff`: Compare two commits as a patch or a changed-path list.
- `show`: Read a file from a commit.
- `log`: Read a bounded commit log.

For example:

```json
{"operation":"resolve","commit":"HEAD"}
```

Use the returned full SHA for later calls. This keeps the inspected revision fixed if the branch moves. For a diff, supply the recorded merge-base SHA as `base` and the reviewed target SHA as `head`.

Commit operands accept full 40- or 64-character SHAs, or `HEAD`. Paths use Git's repository-relative spelling; the tool does not rewrite backslashes as separators.

Output uses UTF-8-safe byte pages. The `limit` is 4 to 51,200 bytes per call. Each Git process has a 10-second time limit and a 64 MiB total output limit. If `details.nextOffset` is present, repeat the same operation with that offset. Read all required pages before treating the evidence as complete. No output file is written to disk. A tool error or an output limit that prevents inspection must block the review, not produce a clean result.

The tool does not provide worktree status. Even `git status` can run repository-defined clean filters. The dormant reviewer supplies worktree status and excluded paths. When the worktree is dirty, the independent helper uses committed file listings and contents instead of local files.

## Restrictions

The tool accepts only its listed operations and fields. It does not accept a shell command, arbitrary Git arguments, another working directory, environment overrides, or an output path. It does not fetch, stage, commit, push, or change worktree files. Git execution helpers and automatic fetching are disabled for inspection. Git must support `--no-lazy-fetch`; an older executable that rejects that option blocks inspection instead of silently allowing automatic fetches.

This is a restricted tool interface, not an operating-system sandbox. It assumes a trusted Git executable, Pi runtime, and loaded extensions. The file-reading tools can still read files permitted by the operating system. The dormant main reviewer retains repair tools; its review-only behavior is controlled by the dormant skill instructions.

The dormant extension requires the matching dormant profiles if it is restored. A resumed session keeps its previous tool permissions.

## Validation

Run `npm run check` from the repository root to check the active setup. The dormant test is not in the active test scripts. Its preserved source at `dormant/tests/test-read-only-git.mjs` still refers to the original active reviewer profiles. Move the dormant resources back into their active directories and update the tests in the same change before you run the restored test. The tool tests use temporary repositories. They do not change the active Pi installation or use a live pull request.
