# SDKWork Local Workspace

This directory stores source-controlled development metadata for the `sdkwork-github-workflow` repository.

Authoritative execution rules:

- `../AGENTS.md`
- `../../sdkwork-specs/SOUL.md`
- `../../sdkwork-specs/SDKWORK_WORKSPACE_SPEC.md`

This directory is not runtime state. Do not commit user-private files, credentials, generated SDK transport output, caches, logs, or temporary artifacts here.

Tracked subdirectories:

- `skills/`: repository-local agent workflows when a workflow needs a `SKILL.md` entrypoint.
- `plugins/`: repository-local plugin bundles when a plugin needs a `.codex-plugin/plugin.json` manifest.

Ignored subdirectories:

- `local/`
- `tmp/`
- `cache/`
- `secrets/`
