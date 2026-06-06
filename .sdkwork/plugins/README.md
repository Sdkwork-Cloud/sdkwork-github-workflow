# SDKWork Repository Plugins

Repository-local plugins may be added under `.sdkwork/plugins/<plugin-name>/`.

Rules:

- Plugin directory names use lowercase kebab-case.
- Installable plugins must declare `.codex-plugin/plugin.json`.
- Plugin skills follow the same rules as `.sdkwork/skills/`.
- Plugins must not vendor unrelated toolchains, credentials, runtime data, generated SDK output, caches, or logs.

See `../../AGENTS.md` and `../../../sdkwork-specs/SDKWORK_WORKSPACE_SPEC.md` before adding a plugin.
