# SDKWork GitHub Workflow Framework

Reusable GitHub Actions workflow framework for SDKWork application packaging, release, and deployment pipelines.

The framework keeps application repositories thin:

1. Each application commits `sdkwork.workflow.json`.
2. Each application adds a small `.github/workflows/package.yml` that calls the framework reusable workflow.
3. The framework owns matrix planning, dependency checkout, toolchain setup, lifecycle execution, artifact upload, release upload, and provenance attestation.

## Design Goals

- One standard packaging contract for all SDKWork applications.
- Support server, desktop, mobile, tablet, web, worker, and library profiles.
- Support Linux, Windows, macOS, Android, Android tablet, iOS, iPadOS, Windows tablet, web, and container targets.
- Support common package formats: `zip`, `tar.gz`, `deb`, `rpm`, `pkg`, `dmg`, `msi`, `msix`, `exe`, `appimage`, `snap`, `flatpak`, `docker`, `oci`, `helm`, `apk`, `aab`, `ipa`, `web`, `static`, `jar`, and `war`.
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
- `scripts/sdkwork-workflow.mjs` - zero-dependency Node CLI and library for validation, matrix planning, dependency planning, and lifecycle execution.
- `schemas/sdkwork-workflow.schema.json` - JSON Schema for `sdkwork.workflow.json`.
- `templates/app-package.workflow.yml` - minimal workflow entrypoint for application repositories.
- `examples/sdkwork-claw-router` - migration example based on the original `sdkwork-claw-router` workflow.
- `examples/mobile-flutter` - mobile packaging example.
- `tests` - Node test coverage for framework behavior.

## Application Integration

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
    "defaultVersion": "0.1.0"
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
      "id": "linux-x64-server-tgz",
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

Add `.github/workflows/package.yml` using the template:

```yaml
name: Package Application

on:
  workflow_dispatch:
    inputs:
      tag:
        required: true
        default: v0.1.0
      package_version:
        required: true
        default: 0.1.0
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
      tag: ${{ inputs.tag }}
      package_version: ${{ inputs.package_version }}
      platform: ${{ inputs.platform }}
      architecture: ${{ inputs.architecture }}
      profile: ${{ inputs.profile }}
      format: ${{ inputs.format }}
      framework_ref: v1
    secrets: inherit
```

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
- `SDKWORK_PACKAGE_PROFILE`
- `SDKWORK_PACKAGE_PLATFORM`
- `SDKWORK_PACKAGE_ARCHITECTURE`
- `SDKWORK_PACKAGE_FORMAT`
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
      "profile": "server",
      "platform": "linux",
      "format": "deb",
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

Render dependency refs from a local file:

```bash
node scripts/sdkwork-workflow.mjs dependencies \
  --config examples/sdkwork-claw-router/sdkwork.workflow.json \
  --dependency-refs-file refs.json \
  --json
```

## Security Baseline

The reusable workflow uses:

- Explicit permissions: `contents: write`, `actions: read`, `id-token: write`, `attestations: write`, `artifact-metadata: write`.
- `concurrency` scoped by repository, ref, and selected package dimensions.
- Artifact attestation through `actions/attest`.
- Lifecycle hooks for application-specific signing and SBOM generation.
- A declarative lifecycle contract so application repositories do not copy release pipeline YAML.
- Path validation for config paths and output globs.
- Secret-like value redaction in framework logs.

OIDC-based cloud publishing should be added as provider-specific publish actions. The framework keeps `id-token: write` available so cloud upload actions can avoid static long-lived credentials.

## Current Scope

This repository provides the reusable workflow framework and the application-side contract. It does not replace application-specific package builders such as Tauri, Flutter, Gradle, WiX, `pkgbuild`, Docker, Helm, or custom SDKWork package scripts. Those commands stay in each application lifecycle config, while orchestration, matrix selection, dependency checkout, artifact handling, and release publishing stay centralized.
