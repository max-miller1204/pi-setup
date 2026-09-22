# Maintenance

## Updating

Update installed Pi extensions:

```bash
pi update --extensions
```

After pulling this repository, rerun `./install.sh` when active agent profiles, settings, or skills have changed. `pi update --extensions` does not update shared skill copies. This repository has no active skills now.

## Copy local changes into the repository

From the repository root, copy only active agent profiles:

```bash
cp ~/.pi/agent/agents/browser-worker.md ~/.pi/agent/agents/researcher.md ~/.pi/agent/agents/scout.md ~/.pi/agent/agents/worker.md agents/
git diff -- agents/
```

Inspect new, untracked files with `git status --short`. For a new active skill, copy its complete directory into `skills/` and add its name to `ownedSkills` in `scripts/test-install.mjs`. Keep helper files and relative links with the skill. Do not add `mcp-scripting`, `playwright-cli`, or `superpowers`; their packages or tools supply them.

The `reviewer`, `review-pass`, `read-only-git`, `iterative-review`, and `reviewed-pr` resources are dormant under `dormant/`. They are not installed by this setup. Previously installed copies can still load. See the one-time manual cleanup steps in [setup](setup.md). To restore a dormant resource to this repository, move it back into its active directory and update tests in the same change.

Compare `~/.pi/agent/settings.json` with `config/settings.json` manually. Copy only portable preferences. Keep the `pi-setup` package entry in the template so new installations load the extensions. Do not copy `lastChangelogVersion`, credentials, or local paths.

## Theme ownership

The `dots-system` theme is deliberately not bundled here. [Dots](https://github.com/max-miller1204/dots) generates and installs it at `~/.pi/agent/themes/dots-system.json`. Publishing the same named theme from this package would create a resource collision.

This repository only selects `dots-system` in `config/settings.json`. Without Dots, choose a built-in Pi theme after installation.

## Validation

Pull requests and pushes to `main` run GitHub Actions checks that:

- reject legacy `@mariozechner/pi-*` and `@sinclair/typebox` imports or dependencies;
- prove the dependency guard catches the original stale-import regression;
- enforce that `dots-system` is selected here but supplied only by Dots;
- test the active and dormant resource layout;
- test new and repeated installs in temporary home directories, confirm no active skill backups are made, and preserve old packages and installed resources;
- type-check the active extensions against the locked Pi API;
- load both active extensions through Pi's RPC runtime; and
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
- externally generated MCP scripting, Playwright CLI, and no-mistakes skills;
- local skill and settings backups;
- the Herdr state extension; and
- the Dots theme ownership marker.

Authenticate providers with `/login` on each computer. Review machine-local configuration before transferring it and never commit secrets.
