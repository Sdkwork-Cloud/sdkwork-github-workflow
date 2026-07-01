# SDKWork GitHub Workflow Framework
repository-kind: foundation-dependency

Reusable GitHub Actions workflow framework for SDKWork application packaging, release, and deployment pipelines.

The framework keeps application repositories thin:

1. Each application commits `sdkwork.workflow.json`.
2. Each application adds a small `.github/workflows/package.yml` that calls the framework reusable workflow.
3. The framework owns matrix planning, dependency checkout, toolchain setup, lifecycle execution, artifact upload, release upload, and provenance attestation.

This repository implements the SDKWork standard in `../sdkwork-specs/GITHUB_WORKFLOW_SPEC.md`.

## Design Goals

- One standard packaging contract for all SDKWork applications.
- Support browser, server, desktop, mobile, tablet, mini-program, container, worker, library, and test package profiles.
- Support standalone/cloud deployment profiles separately from browser, desktop, server, container, mobile, tablet, mini program, and test runtime targets.
- Support Linux, Windows, macOS, Android, Android tablet, iOS, iPadOS, Windows tablet, web, H5, Harmony, mini program, test, and container targets.
- Support common package formats: `zip`, `tar.gz`, `deb`, `rpm`, `pkg`, `dmg`, `msi`, `msix`, `exe`, `appimage`, `snap`, `flatpak`, `docker`, `oci`, `helm`, `apk`, `aab`, `ipa`, `web`, `web-url`, `static`, `mini-program-package`, `jar`, `war`, and `other`.
- Support declared dependency repositories with ref inputs.
- Use GitHub Actions reusable workflows and composite actions instead of copied YAML.
- Align with current CI/CD standards: least-privilege permissions, OIDC-ready publishing, artifact attestations, deterministic matrix planning, and release artifact validation hooks.

## Repository Layout

- `.github/workflows/sdkwork-package.yml` - reusable workflow called by application repositories.
- `actions/validate-config` - composite action for config validation.
- `actions/checkout-dependencies` - composite action for dependency repository checkout.
- `actions/setup-toolchains` - composite action for declared language and packaging toolchains.
- `actions/run-lifecycle` - composite action that executes application lifecycle phases.
- `actions/publish-release` - composite action for GitHub Release asset publishing.
- `scripts/sdkwork-workflow.mjs` - zero-dependency Node CLI and library for validation, matrix planning, dependency planning, changelog rendering, and lifecycle execution.
- `schemas/sdkwork-workflow.schema.json` - JSON Schema for `sdkwork.workflow.json`.
- `templates/app-package.workflow.yml` - minimal workflow entrypoint for application repositories.
- `examples/sdkwork-clawrouter` - migration example based on the original `sdkwork-clawrouter` workflow.
- `examples/mobile-flutter` - mobile packaging example.
- `tests` - Node test coverage for framework behavior.

## Application Integration

Use the generator for a new application repository:

```bash
node scripts/sdkwork-workflow.mjs init-app \
  --root ../my-app \
  --app-id my-app \
  --app-name "My App" \
  --repository Sdkwork-Cloud/my-app \
  --profiles server,desktop,tablet \
  --framework-ref v1
```

The generator writes:

- `sdkwork.workflow.json`
- `.github/workflows/package.yml`

It refuses to overwrite existing files unless `--force` is passed. Generated lifecycle placeholder steps use `shell: "node"` and read SDKWork values through `process.env` so the starter workflow behaves the same on Linux, Windows, and macOS runners.

For `--profiles server,desktop`, the starter config includes these package targets by default:

| Profile | Package ids |
| --- | --- |
| server | `linux-debian-x64-standalone-server-deb`, `linux-rhel-x64-standalone-server-rpm`, `linux-x64-standalone-server-tar-gz` |
| desktop | `windows-x64-standalone-desktop-msi`, `windows-x64-standalone-desktop-exe`, `macos-arm64-standalone-desktop-dmg` |

Add `sdkwork.workflow.json` to the application repository:

```json
{
  "$schema": "https://sdkwork.com/schemas/sdkwork-workflow.schema.json",
  "schemaVersion": "2026-06-06.sdkwork.workflow.v1",
  "app": {
    "id": "my-app",
    "repository": "Sdkwork-Cloud/my-app",
    "sourcePath": "."
  },
  "release": {
    "artifactPrefix": "my-app",
    "defaultVersion": "0.1.0",
    "changelog": {
      "source": "auto"
    }
  },
  "toolchains": {
    "node": "22",
    "pnpm": "10.33.0"
  },
  "lifecycle": {
    "install": [{ "run": "pnpm install --frozen-lockfile" }],
    "build": [{ "run": "pnpm build" }],
    "package": [{ "run": "pnpm package -- --package-id $SDKWORK_PACKAGE_ID" }],
    "validate": [{ "run": "pnpm package:validate -- --package-id $SDKWORK_PACKAGE_ID" }]
  },
  "targets": [
    {
      "id": "linux-x64-standalone-server-tar-gz",
      "deploymentProfile": "standalone",
      "runtimeTarget": "server",
      "profile": "server",
      "platform": "linux",
      "architecture": "x64",
      "formats": ["tar.gz"],
      "runner": "ubuntu-24.04",
      "outputGlobs": ["dist/*.tar.gz", "dist/*.manifest.json"]
    }
  ]
}
```

Package matrix items use one canonical package id:

```text
<platform>-<architecture>-<deployment-profile>-<profile>-<format-token>
```

Linux native `deb` and `rpm` packages include the distribution family because dependency metadata, repository channels, signing, and install validation differ by family:

```text
linux-<distribution>-<architecture>-<deployment-profile>-<profile>-<format-token>
```

Use `distribution: "debian"` or `distribution: "ubuntu"` for `deb`, and `distribution: "rhel"`, `"centos"`, `"fedora"`, `"opensuse"`, or `"suse"` for `rpm`. Generic Linux archives such as `tar.gz` do not include `distribution`.

When one platform produces installer formats with different file globs, declare separate single-format targets. For example, prefer `windows-x64-standalone-desktop-msi` and `windows-x64-standalone-desktop-exe` as separate targets over one multi-format Windows target when the `.msi` and `.exe` files are collected by different globs.

`format-token` is the package format normalized to lowercase kebab-case, so `tar.gz` becomes `tar-gz`. GitHub artifact names prepend `release.artifactPrefix`:

```text
<artifactPrefix>-<package-id>
```

Examples:

| Profile | Platform | Deployment profile | Runtime target | Distribution | Architecture | Format | Package id | Artifact name with `artifactPrefix: my-app` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| server | linux | standalone | server | debian | x64 | deb | `linux-debian-x64-standalone-server-deb` | `my-app-linux-debian-x64-standalone-server-deb` |
| server | linux | standalone | server | ubuntu | arm64 | deb | `linux-ubuntu-arm64-standalone-server-deb` | `my-app-linux-ubuntu-arm64-standalone-server-deb` |
| server | linux | standalone | server | rhel | x64 | rpm | `linux-rhel-x64-standalone-server-rpm` | `my-app-linux-rhel-x64-standalone-server-rpm` |
| desktop | linux | standalone | desktop | fedora | x64 | rpm | `linux-fedora-x64-standalone-desktop-rpm` | `my-app-linux-fedora-x64-standalone-desktop-rpm` |
| server | linux | standalone | server | omitted | x64 | tar.gz | `linux-x64-standalone-server-tar-gz` | `my-app-linux-x64-standalone-server-tar-gz` |
| container | container | cloud | container | omitted | arm64 | oci | `container-arm64-cloud-container-oci` | `my-app-container-arm64-cloud-container-oci` |
| desktop | windows | standalone | desktop | omitted | x64 | msi | `windows-x64-standalone-desktop-msi` | `my-app-windows-x64-standalone-desktop-msi` |
| desktop | windows | standalone | desktop | omitted | x64 | exe | `windows-x64-standalone-desktop-exe` | `my-app-windows-x64-standalone-desktop-exe` |
| desktop | macos | standalone | desktop | omitted | arm64 | dmg | `macos-arm64-standalone-desktop-dmg` | `my-app-macos-arm64-standalone-desktop-dmg` |
| browser | web | cloud | browser | omitted | universal | web-url | `web-universal-cloud-browser-web-url` | `my-app-web-universal-cloud-browser-web-url` |
| mobile | android | standalone | flutter-android | omitted | arm64 | aab | `android-arm64-standalone-mobile-aab` | `my-app-android-arm64-standalone-mobile-aab` |
| mobile | ios | standalone | flutter-ios | omitted | universal | ipa | `ios-universal-standalone-mobile-ipa` | `my-app-ios-universal-standalone-mobile-ipa` |
| tablet | ipados | standalone | tablet-ipados | omitted | universal | ipa | `ipados-universal-standalone-tablet-ipa` | `my-app-ipados-universal-standalone-tablet-ipa` |
| mini-program | mp-weixin | cloud | mini-program | omitted | universal | mini-program-package | `mp-weixin-universal-cloud-mini-program-mini-program-package` | `my-app-mp-weixin-universal-cloud-mini-program-mini-program-package` |

## Release Changelog

Every GitHub Release published by the reusable workflow renders a Release notes file before uploading assets. The default generated app config uses:

```json
{
  "release": {
    "changelog": {
      "source": "auto"
    }
  }
}
```

`source: "auto"` resolves notes in this order:

1. `sdkwork.app.config.json` `release.notes[]`, matching `package_version`, release tag, or the current note.
2. `CHANGELOG.md` at the repository root.
3. Recent git commit subjects.

Applications can choose an explicit source:

| Source | Behavior |
| --- | --- |
| `auto` | Manifest notes, then `CHANGELOG.md`, then git commit subjects. |
| `app-manifest` | Require a matching `release.notes[]` entry in `app.configPath` or `sdkwork.app.config.json`. |
| `file` | Require a markdown file declared by `release.changelog.path`, for example `CHANGELOG.md`. |
| `git` | Render recent git commit subjects. |
| `none` | Render only the standard SDKWork release/package summary. |

Optional fields:

- `release.changelog.enabled`: set `false` to use the standard summary only.
- `release.changelog.path`: safe relative markdown path for `source: "file"`.
- `release.changelog.includeCommitSubjects`: set `false` to omit commit subjects in git fallback.
- `release.changelog.maxCommitSubjects`: integer from 1 to 200, default 50.

Render notes locally:

```bash
node scripts/sdkwork-workflow.mjs changelog \
  --config sdkwork.workflow.json \
  --version 1.2.0 \
  --release-tag v1.2.0 \
  --output .sdkwork/release/release-notes.md
```

Add `.github/workflows/package.yml` using the template:

```yaml
name: Package Application

on:
  push:
    tags:
      - v*
      - '*.*.*'
  release:
    types:
      - published
  workflow_dispatch:
    inputs:
      tag:
        required: false
        default: v0.1.0
      package_version:
        required: false
        default: 0.1.0
      deployment_profile:
        required: true
        default: all
      runtime_target:
        required: true
        default: all
      platform:
        required: true
        default: all
      architecture:
        required: true
        default: all
      profile:
        required: true
        default: all
      format:
        required: true
        default: all

jobs:
  package:
    uses: Sdkwork-Cloud/sdkwork-github-workflow/.github/workflows/sdkwork-package.yml@v1
    with:
      config_path: sdkwork.workflow.json
      tag: ${{ github.event.inputs.tag || github.event.release.tag_name || github.ref_name }}
      package_version: ${{ github.event.inputs.package_version || github.event.release.tag_name || github.ref_name }}
      deployment_profile: ${{ github.event.inputs.deployment_profile || 'all' }}
      runtime_target: ${{ github.event.inputs.runtime_target || 'all' }}
      platform: ${{ github.event.inputs.platform || 'all' }}
      architecture: ${{ github.event.inputs.architecture || 'all' }}
      profile: ${{ github.event.inputs.profile || 'all' }}
      format: ${{ github.event.inputs.format || 'all' }}
      deploy: ${{ github.event.inputs.deploy == 'true' || github.event_name == 'release' }}
      framework_ref: v1
    secrets: inherit
```

The standard application workflow supports three entrypoints:

- `push` tag: package the pushed release tag.
- `release.published`: package and run configured deployments by default.
- `workflow_dispatch`: manually package or deploy a selected deployment profile, runtime target, platform, package profile, architecture, variant, or format.

## Lifecycle Contract

The framework executes configured phases in this order:

1. `preflight`
2. `install`
3. `build`
4. `stage`
5. `package`
6. `sign`
7. `sbom`
8. `validate`

When `deploy: true` is passed to the reusable workflow, it then runs deployment matrix jobs. Each deployment job executes either:

- `deploy`
- `publish`

Every lifecycle command receives standard environment variables:

- `SDKWORK_APP_ID`
- `SDKWORK_APP_REPOSITORY`
- `SDKWORK_APP_SOURCE_PATH`
- `SDKWORK_RELEASE_TAG`
- `SDKWORK_PACKAGE_VERSION`
- `SDKWORK_PACKAGE_TARGET_ID`
- `SDKWORK_PACKAGE_ID`
- `SDKWORK_DEPLOYMENT_PROFILE`
- `SDKWORK_RUNTIME_TARGET`
- `SDKWORK_PACKAGE_PROFILE`
- `SDKWORK_PACKAGE_PLATFORM`
- `SDKWORK_PACKAGE_ARCHITECTURE`
- `SDKWORK_PACKAGE_FORMAT`
- `SDKWORK_PACKAGE_DISTRIBUTION` for Linux native `deb` and `rpm` packages
- `SDKWORK_DEPLOY_ENVIRONMENT`
- `SDKWORK_DEPLOY_URL`
- `SDKWORK_DEPLOY_LIFECYCLE`

Lifecycle steps support `bash`, `sh`, `pwsh`, `powershell`, `cmd`, and `node` shells. They intentionally support `run` commands only. Shared `uses:` actions belong in this framework as composite actions, because GitHub Actions cannot safely materialize dynamic `uses:` steps from runtime configuration.

## Deployment Contract

Deployment targets are declared in `sdkwork.workflow.json`:

```json
{
  "deployments": [
    {
      "id": "production-server",
      "environment": "production",
      "deploymentProfile": "standalone",
      "runtimeTarget": "server",
      "profile": "server",
      "platform": "linux",
      "format": "deb",
      "packageId": "linux-debian-x64-standalone-server-deb",
      "runner": "ubuntu-24.04",
      "url": "https://api.sdkwork.com/apps/my-app",
      "lifecycle": "deploy"
    }
  ]
}
```

The reusable workflow maps each deployment item to selected package targets and binds the job to GitHub Environments:

```yaml
environment:
  name: ${{ matrix.environment }}
  url: ${{ matrix.url }}
```

Use GitHub Environment protection rules for production approvals and environment-scoped secrets. Cloud deployment actions should use OIDC where possible instead of static credentials.

Deployment lifecycle jobs receive `SDKWORK_DEPLOY_ENVIRONMENT`, `SDKWORK_DEPLOY_URL`, and `SDKWORK_DEPLOY_LIFECYCLE` explicitly so local lifecycle plans and GitHub deployment jobs use the same context model.

Deployment selectors must match at least one package target in the full workflow config. A typo in `targetId`, `packageId`, profile, platform, architecture, or format fails validation instead of silently skipping all deployment jobs.

## Tablet Packaging

Tablet packages are a first-class profile, not just a mobile variant. Use:

- `profile: "tablet"`
- `platform: "ipados"` for iPadOS `.ipa` packages
- `platform: "android-tablet"` for Android tablet `.apk` or `.aab` packages
- `platform: "windows-tablet"` for Windows tablet `.msix`, `.msi`, or `.exe` packages

The tablet profile lets applications apply tablet-specific layouts, signing identities, app-store channels, package globs, and deployment environments without mixing them into phone-oriented mobile packages.

## Dependency Contract

Dependencies are declared in `sdkwork.workflow.json`:

```json
{
  "dependencies": [
    {
      "id": "sdkwork-appbase",
      "repository": "Sdkwork-Cloud/sdkwork-appbase",
      "refInput": "SDKWORK_APPBASE_REF",
      "path": "apps/sdkwork-appbase",
      "tokenSecret": "SDKWORK_RELEASE_TOKEN",
      "submodules": "recursive"
    }
  ]
}
```

The reusable workflow resolves dependency refs from environment variables, then `actions/checkout-dependencies` checks them out before build phases.

The app workflow template passes refs as `dependency_refs_json`, which keeps the reusable workflow generic:

```yaml
dependency_refs_json: >-
  {
    "SDKWORK_APPBASE_REF": "${{ vars.SDKWORK_APPBASE_REF }}",
    "SDKWORK_CORE_REF": "${{ vars.SDKWORK_CORE_REF }}"
  }
```

Dependency refs are validated as safe Git refs before checkout. Dependency ref JSON is passed to the planner through an environment variable before shell execution instead of direct expression interpolation. When `dependencies[].path` is omitted, the dependency is checked out as a runner-local sibling of the application repository, for example `../<id>`, so native build-tool workspace paths keep the same shape in local development and CI. Explicit dependency checkout paths must not overlap the application source path or `.sdkwork/github-workflow`. The v1 framework supports `SDKWORK_RELEASE_TOKEN` as the dependency checkout token; other per-dependency `tokenSecret` names are rejected until a future token-map contract is added. Checkout logic passes tokens through Git credential headers instead of clone URLs.

## Local Validation

Run tests:

```bash
npm test
```

Run full repository validation:

```bash
npm run validate
```

Validate the claw-router example:

```bash
npm run validate:example
```

Render an example matrix:

```bash
npm run matrix:example
```

Render release notes:

```bash
node scripts/sdkwork-workflow.mjs changelog \
  --config examples/sdkwork-clawrouter/sdkwork.workflow.json \
  --version 0.3.0 \
  --release-tag v0.3.0 \
  --output tmp/release-notes.md
```

Render dependency refs from a local file:

```bash
node scripts/sdkwork-workflow.mjs dependencies \
  --config examples/sdkwork-clawrouter/sdkwork.workflow.json \
  --dependency-refs-file refs.json \
  --json
```

Generate an application bootstrap:

```bash
node scripts/sdkwork-workflow.mjs init-app \
  --root ../my-app \
  --app-id my-app \
  --repository Sdkwork-Cloud/my-app \
  --profiles server,tablet
```

## Security Baseline

The reusable workflow uses:

- Explicit permissions: `contents: write`, `actions: read`, `id-token: write`, `attestations: write`, `artifact-metadata: write`.
- `concurrency` scoped by repository, ref, and selected package dimensions.
- Artifact attestation through `actions/attest`.
- Lifecycle hooks for application-specific signing and SBOM generation.
- Policy validation for required signing and SBOM hooks: `security.signingRequired` requires `lifecycle.sign`, and `security.sbomRequired` requires `lifecycle.sbom`.
- Config-driven publication gates: `publish.workflowArtifact`, `publish.githubRelease`, and `publish.retentionDays` are enforced by the reusable workflow in addition to caller inputs.
- Config-driven changelog rendering: Release notes are generated by the framework from `release.changelog`, passed through an environment-file boundary, and supplied to GitHub Release publishing through `--notes-file`.
- Config-driven attestation gate: `security.artifactAttestations: false` disables provenance attestation; omitted values keep attestation enabled.
- A declarative lifecycle contract so application repositories do not copy release pipeline YAML.
- Toolchain setup consumes every supported planner output, including `.NET`, Android SDK, and Xcode setup.
- Path validation for config paths and output globs.
- Strict planner/schema alignment: unknown config properties, schema-declared type violations, empty target lists, and duplicate target formats fail validation.
- Shell-based actions read workflow/action inputs through environment variables before command execution instead of embedding expressions directly in scripts.
- Secret-like value redaction in framework logs.

OIDC-based cloud publishing should be added as provider-specific publish actions. The framework keeps `id-token: write` available so cloud upload actions can avoid static long-lived credentials.

## Current Scope

This repository provides the reusable workflow framework and the application-side contract. It does not replace application-specific package builders such as Tauri, Flutter, Gradle, WiX, `pkgbuild`, Docker, Helm, or custom SDKWork package scripts. Those commands stay in each application lifecycle config, while orchestration, matrix selection, dependency checkout, artifact handling, and release publishing stay centralized.

## SDKWork Documentation Contract

Domain: intelligence
Capability: github-workflow
Package type: node-package
Status: standard

### Public API

Public exports are declared in `specs/component.spec.json` under `contracts.publicExports`.

### Required SDK Surface

- None declared in `specs/component.spec.json`.

### Configuration

Configuration keys and runtime entrypoints are declared in `specs/component.spec.json`.

### SaaS/Private/Local Behavior

This module follows the canonical standards linked from `specs/component.spec.json`, including deployment and runtime configuration rules where applicable.

### Security

Do not add secrets, live tokens, manual auth headers, or app-local credential handling to this module.

### Extension Points

Extension points are limited to declared public exports, runtime entrypoints, SDK clients, events, and config keys.

### Verification

- `pnpm test`

### Owner And Status

Owner and lifecycle status are tracked in `specs/component.spec.json`.

## Documentation Canon

- [docs/README.md](docs/README.md)
- [docs/product/prd/PRD.md](docs/product/prd/PRD.md)
- [docs/architecture/tech/TECH_ARCHITECTURE.md](docs/architecture/tech/TECH_ARCHITECTURE.md)

## Application Roots

- [apps directory index](apps/README.md)
