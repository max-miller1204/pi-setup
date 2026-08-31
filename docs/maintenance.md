# Maintenance

## Updating

Update installed Pi extensions:

```bash
pi update --extensions
```

After pulling this repository, rerun `./install.sh` when agent profiles or settings have changed.

## Theme ownership

The `dots-system` theme is deliberately not bundled here. [Dots](https://github.com/max-miller1204/dots) generates and installs it at `~/.pi/agent/themes/dots-system.json`. Publishing the same named theme from this package would create a resource collision.

This repository only selects `dots-system` in `config/settings.json`. Without Dots, choose a built-in Pi theme after installation.

## Validation

Pull requests and pushes to `main` run GitHub Actions checks that:

- reject legacy `@mariozechner/pi-*` and `@sinclair/typebox` imports or dependencies;
- prove the dependency guard catches the original stale-import regression;
- enforce that `dots-system` is selected here but supplied only by Dots;
- type-check the extensions against the locked Pi API;
- load both extensions through Pi's RPC runtime; and
- reject dependency vulnerabilities reported by `npm audit`.

Run the same checks locally:

```bash
npm ci --ignore-scripts
npm run check
npm audit --audit-level=low
```

## Security and exclusions

This repository intentionally excludes:

- provider credentials and API keys;
- sessions and trust decisions;
- caches, installed dependencies, and generated model catalogs;
- nested package clones and local development artifacts;
- externally generated Playwright CLI and no-mistakes skills;
- the Herdr state extension; and
- the Dots theme ownership marker.

Authenticate providers with `/login` on each computer. Review machine-local configuration before transferring it and never commit secrets.
