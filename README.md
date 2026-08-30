# pi-setup

My personal setup for the [Pi coding agent](https://pi.dev): extensions, sub-agent profiles, theme, package list, and runtime preferences.

## Included

- `extensions/ask-user-question.ts` — structured single- and multi-choice user prompts
- `extensions/custom-header.ts` — custom Pi startup header
- `agents/` — browser, research, scout, and general worker profiles for `pi-interactive-subagents`
- `themes/dots-system.json` — Tokyo Night-inspired terminal theme
- `config/settings.json` — preferred models, thinking level, packages, observational-memory settings, and fullscreen TUI preferences

## Install

Requirements: Pi, Git, Python 3, and tmux for sub-agents.

```bash
git clone https://github.com/max-miller1204/pi-setup.git
cd pi-setup
./install.sh
```

The installer:

1. backs up an existing `~/.pi/agent/settings.json`;
2. installs the Pi packages listed in `config/settings.json`;
3. copies the custom agent profiles to `~/.pi/agent/agents/`; and
4. merges the shared preferences into your existing settings.

Then launch `pi` and use `/login` to configure your own provider credentials. The `browser-worker` profile also expects the optional `playwright-cli` skill.

You can install only the package resources without applying the full settings:

```bash
pi install git:github.com/max-miller1204/pi-setup
```

## Updating

```bash
pi update --extensions
```

Re-run `./install.sh` after pulling this repository when agent profiles or settings change.

## Security and exclusions

This repository intentionally excludes credentials (`auth.json`), sessions, trust decisions, caches, installed dependencies, generated model catalogs, nested package clones, and local development artifacts. The Herdr state extension and dots ownership marker are machine-managed and are also excluded.

Provider authentication remains local and must be configured with `/login`.
