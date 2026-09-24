# Read-only Git inspection

This extension is parked in `extensions/dormant/read-only-git.ts`.
Pi does not load it.

The `read_only_git` tool lets an independent reviewer inspect committed source without a shell. The reviewer profile also lists the tool so the subagent launcher can pass the extension to its helper.

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

The tool does not provide worktree status. Even `git status` can run repository-defined clean filters. The reviewer supplies worktree status and excluded paths. When the worktree is dirty, the independent helper uses committed file listings and contents instead of local files.

## Restrictions

The tool accepts only its listed operations and fields. It does not accept a shell command, arbitrary Git arguments, another working directory, environment overrides, or an output path. It does not fetch, stage, commit, push, or change worktree files. Git execution helpers and automatic fetching are disabled for inspection. Git must support `--no-lazy-fetch`; an older executable that rejects that option blocks inspection instead of silently allowing automatic fetches.

This is a restricted tool interface, not an operating-system sandbox. It assumes a trusted Git executable, Pi runtime, and loaded extensions. The file-reading tools can still read files permitted by the operating system. The main reviewer retains repair tools; its review-only behavior is controlled by the skill instructions.

Install the extension with the updated profiles, then start a new reviewer session. A resumed session keeps its previous tool permissions.

## Validation

Run from the repository root:

```bash
npm run test:read-only-git
npm run check
```

The tool tests use temporary repositories. They call the registered tool and load it with Pi. They do not change the active Pi installation or use a live pull request.
