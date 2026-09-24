# pi-setup

[![CI](https://github.com/max-miller1204/pi-setup/actions/workflows/ci.yml/badge.svg)](https://github.com/max-miller1204/pi-setup/actions/workflows/ci.yml)

My personal setup for the [Pi coding agent](https://pi.dev).

## Included

- `extensions/` - Pi extensions that this package loads.
- `agents/` - sub-agent profiles, copied to `~/.pi/agent/agents/`.
- `skills/` - custom skills, copied to `~/.agents/skills/`.
- `config/settings.json` - models, packages, runtime preferences, and theme selection.
  The installer installs each package in this file.
- `config/subagent-profiles.json` - model and thinking profiles that agents select when they start sub-agents.
  The installer copies it to `~/.pi/agent/subagent-profiles.json`.

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
