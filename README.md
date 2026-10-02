# pi-setup

[![CI](https://github.com/max-miller1204/pi-setup/actions/workflows/ci.yml/badge.svg)](https://github.com/max-miller1204/pi-setup/actions/workflows/ci.yml)

My personal setup for the [Pi coding agent](https://pi.dev).

## Included

- `extensions/` - Pi extensions that this package loads.
- `agents/` - sub-agents for the `subagent` extension, copied to `~/.pi/agent/agents/`.
- `prompts/` - workflow prompt templates that chain the sub-agents. This package loads them.
- `skills/` - custom skills, copied to `~/.agents/skills/`.
- `config/settings.json` - models, packages, runtime preferences, and theme selection.
  The installer installs each package in this file.

## Extensions

| Extension | What it does |
|---|---|
| `ask-user-question.ts` | Lets the agent ask you one question with options or free text. |
| `background-subagents.ts` | Starts named sub-agents that work in the background. Their answers come back as messages. Port of pi-durable `23-subagent-background.ts`. |
| `bash-venv-timing.ts` | Times each `bash` call (`/bash-timings`). `/venv` runs `bash` inside `.venv`. Port of pi-durable `30-tool-override.ts`. |
| `custom-header.ts` | Shows a custom header. |
| `git-checkpoint.ts` | Saves the working tree at each prompt. When you fork, it offers to restore the code. Fixed copy of the Pi example. |
| `handoff.ts` | `/handoff <goal>` moves the useful context into a new session. Pi example. |
| `plan-mode/` | `/plan` turns on read-only planning with step tracking. Pi example, changed to use `ask_user_question` and `web_search`. |
| `qna.ts` | `/qna` copies the questions from the last answer into the editor. Pi example. |
| `reviewer.ts` | The `review` tool and `/review` start a read-only reviewer on the uncommitted changes. It looks again until it has no findings. Port of pi-durable `28-reviewer.ts`. |
| `subagent/` | The `subagent` tool runs the agents in `agents/` as single, parallel, or chained tasks. Pi example. |
| `tools.ts` | `/tools` turns tools on and off for the session. Pi example. |

The agents in `agents/` are the Pi example agents: `scout`, `planner`, `reviewer`, and `worker`.
Their Claude models are changed to `openai-codex` models.

Each `dormant/` folder holds parked resources.
The installer and Pi do not load them.
To use a parked resource again, move it out of its `dormant/` folder.

## Quick install

The recommended setup uses [Dots](https://github.com/max-miller1204/dots) for prerequisites and the `dots-system` theme.

```bash
git clone https://github.com/max-miller1204/pi-setup.git
cd pi-setup
./install.sh
```

## Documentation

- New-computer setup and machine-local configuration — [`docs/setup.md`](docs/setup.md)
- Updating, theme ownership, validation, and security — [`docs/maintenance.md`](docs/maintenance.md)
