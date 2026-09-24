# Maintenance

## Updating

Update installed Pi extensions:

```bash
pi update --extensions
```

After pulling this repository, rerun `./install.sh` when agent profiles, settings, or skills have changed. `pi update --extensions` does not update the shared skill copies.

## Copy local changes into the repository

From the repository root, copy the active and parked agent profiles and the sub-agent profiles:

```bash
cp ~/.pi/agent/agents/*.md agents/
cp ~/.pi/agent/agents/dormant/*.md agents/dormant/
cp ~/.pi/agent/subagent-profiles.json config/
git diff -- agents/ config/
```

For each custom skill, copy its complete directory from `~/.agents/skills/` into `skills/`.
Keep helper files and relative links with the skill.
Do not add `mcp-scripting` or `playwright-cli`.
Their tools supply them.

Inspect new, untracked files with `git status --short`.
Remove repository files that you deleted from the live configuration.

## Park or reactivate a resource

To park an agent, skill, or extension, move it into the `dormant/` folder next to it.
The installer and Pi do not load files in `dormant/` folders.
To reactivate a resource, move it out of its `dormant/` folder and rerun `./install.sh`.

Compare `~/.pi/agent/settings.json` with `config/settings.json` manually. Copy only portable preferences. Keep the `pi-setup` package entry in the template so new installations load the extensions. Do not copy `lastChangelogVersion`, credentials, or local paths.

## Theme ownership

The `dots-system` theme is deliberately not bundled here. [Dots](https://github.com/max-miller1204/dots) generates and installs it at `~/.pi/agent/themes/dots-system.json`. Publishing the same named theme from this package would create a resource collision.

This repository only selects `dots-system` in `config/settings.json`. Without Dots, choose a built-in Pi theme after installation.

## Validation

Pull requests and pushes to `main` run GitHub Actions checks that:

- reject legacy `@mariozechner/pi-*` and `@sinclair/typebox` imports or dependencies;
- prove the dependency guard catches the original stale-import regression;
- type-check the active extensions against the locked Pi API;
- load each active extension through Pi's RPC runtime; and
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
