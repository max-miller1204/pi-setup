# Maintenance

## Updating

Update installed Pi extensions:

```bash
pi update --extensions
```

After pulling this repository, rerun `./install.sh` when agent profiles, settings, or skills have changed. `pi update --extensions` does not update the shared skill copies.

## Copy local changes into the repository

From the repository root, copy agent profiles and the two custom skills:

```bash
cp ~/.pi/agent/agents/*.md agents/
cp -R ~/.agents/skills/iterative-review skills/
cp -R ~/.agents/skills/reviewed-pr skills/
git diff -- agents/ skills/
```

Inspect new, untracked files with `git status --short`. For another custom skill, copy its complete directory into `skills/` and add its name to `ownedSkills` in `scripts/test-install.mjs`. Keep helper files and relative links with the skill. Do not add `mcp-scripting` or `playwright-cli`; their tools supply them.

Compare `~/.pi/agent/settings.json` with `config/settings.json` manually. Copy only portable preferences. Keep the `pi-setup` package entry in the template so new installations load the extensions. Do not copy `lastChangelogVersion`, credentials, or local paths.

## Theme ownership

The `dots-system` theme is deliberately not bundled here. [Dots](https://github.com/max-miller1204/dots) generates and installs it at `~/.pi/agent/themes/dots-system.json`. Publishing the same named theme from this package would create a resource collision.

This repository only selects `dots-system` in `config/settings.json`. Without Dots, choose a built-in Pi theme after installation.

## Validation

Pull requests and pushes to `main` run GitHub Actions checks that:

- reject legacy `@mariozechner/pi-*` and `@sinclair/typebox` imports or dependencies;
- prove the dependency guard catches the original stale-import regression;
- enforce that `dots-system` is selected here but supplied only by Dots;
- test new and repeated installs in temporary home directories, check skill backups, preserve external skills, and load skills with Pi;
- test Git inspection and rejected mutations in temporary repositories, and load the review helper's tool selection with Pi;
- type-check the extensions against the locked Pi API;
- load all three extensions through Pi's RPC runtime; and
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
