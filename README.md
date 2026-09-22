# pi-setup

[![CI](https://github.com/max-miller1204/pi-setup/actions/workflows/ci.yml/badge.svg)](https://github.com/max-miller1204/pi-setup/actions/workflows/ci.yml)

My personal setup for the [Pi coding agent](https://pi.dev).

## Included

- `extensions/`: active `ask-user-question` and `custom-header` extensions
- `agents/`: active `browser-worker`, `researcher`, `scout`, and `worker` profiles
- `config/settings.json`: models, runtime preferences, theme selection, and seven packages. These include `superpowers`, `pi-session-tasks`, and the `max-miller1204/pi-observational-memory` fork.
- `dormant/`: preserved `reviewer`, `review-pass`, `read-only-git`, `iterative-review`, and `reviewed-pr` resources. The installer does not install or load them.

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
