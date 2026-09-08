# pi-setup

[![CI](https://github.com/max-miller1204/pi-setup/actions/workflows/ci.yml/badge.svg)](https://github.com/max-miller1204/pi-setup/actions/workflows/ci.yml)

My personal setup for the [Pi coding agent](https://pi.dev).

## Included

- `extensions/` — structured user prompts, custom startup header, and read-only Git inspection
- `agents/` — browser, research, scout, worker, and review profiles
- `skills/` — `iterative-review` and `reviewed-pr`, installed in `~/.agents/skills/`
- `config/settings.json` — models, packages, runtime preferences, and theme selection

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
