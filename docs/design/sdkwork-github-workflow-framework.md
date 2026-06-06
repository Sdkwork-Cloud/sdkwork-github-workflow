# SDKWork GitHub Workflow Framework Design

## Problem

SDKWork applications need to be committed to Git and packaged or deployed through GitHub Actions. If every application authors its own workflow, packaging logic fragments quickly:

- Matrix definitions drift across repositories.
- Dependency checkout logic is copied and hard to audit.
- Desktop, server, mobile, and container package formats use different conventions.
- Release upload, artifact retention, and validation policies become inconsistent.
- Security posture depends on the habits of each repository.

The `sdkwork-claw-router` workflow demonstrates the required capability set, but it mixes framework concerns and application-specific build commands in one YAML file.

## Recommended Architecture

Use an independent reusable workflow repository:

- Application repositories own `sdkwork.workflow.json`.
- Application repositories keep a thin workflow entrypoint that calls `Sdkwork-Cloud/sdkwork-github-workflow/.github/workflows/sdkwork-package.yml@v1`.
- This framework owns reusable orchestration and composite actions.
- Application-specific build/package/validate commands are declared as lifecycle steps.

This follows the current GitHub Actions reusable workflow model and avoids vendoring large workflow files into every application.

## Core Components

### Configuration Schema

`schemas/sdkwork-workflow.schema.json` defines the application contract:

- `app`: app id, repository, source path.
- `release`: artifact prefix and default version.
- `dependencies`: repository, ref input, checkout path, token secret, submodule mode.
- `toolchains`: Node, pnpm, Python, Java, Go, Rust, Flutter, Android, Xcode, WiX.
- `lifecycle`: preflight, install, build, stage, package, validate, publish command phases.
- `targets`: profile, platform, architecture, formats, runner, output globs.
- `security`: OIDC, attestations, SBOM, signing flags.
- `publish`: workflow artifact and GitHub Release settings.

### Planner CLI

`scripts/sdkwork-workflow.mjs` is a zero-dependency Node tool used by tests and workflows.

It provides:

- `validate`: validates config.
- `matrix`: builds the GitHub Actions matrix.
- `dependencies`: builds dependency checkout metadata.
- `lifecycle`: renders or executes a lifecycle phase for a target.

The planner is intentionally outside YAML so matrix logic can be tested.

### Reusable Workflow

`.github/workflows/sdkwork-package.yml` has two jobs:

- `plan`: checks out app and framework, validates config, resolves matrix, resolves dependencies.
- `package`: runs per target, checks out app/framework/dependencies, sets up toolchains, runs lifecycle phases, uploads workflow artifacts, attests provenance, uploads release assets.

### Composite Actions

- `actions/validate-config`
- `actions/checkout-dependencies`
- `actions/setup-toolchains`
- `actions/run-lifecycle`
- `actions/publish-release`

Composite actions keep the main workflow readable and reusable.

## Target Model

The framework supports these profiles:

- `server`
- `desktop`
- `mobile`
- `web`
- `worker`
- `library`

The framework supports these platforms:

- `linux`
- `windows`
- `macos`
- `android`
- `ios`
- `web`
- `container`

The framework supports these architectures:

- `x64`
- `arm64`
- `armv7`
- `universal`
- `wasm32`
- `noarch`

The framework supports these package formats:

- Archive: `zip`, `tar.gz`
- Linux native: `deb`, `rpm`, `appimage`, `snap`, `flatpak`
- macOS native: `pkg`, `dmg`
- Windows native: `msi`, `exe`
- Container: `docker`, `oci`, `helm`
- Mobile: `apk`, `aab`, `ipa`
- Web/JVM: `web`, `static`, `jar`, `war`

## Migration From sdkwork-claw-router

The original workflow contains these framework-level concepts:

- `workflow_dispatch` inputs for tag/version/platform/architecture/deployment mode.
- Matrix planner.
- Dependency repository checkout.
- Node/pnpm/Python/Rust/WiX setup.
- Application build.
- Staging.
- Native/archive package generation.
- Artifact validation.
- Artifact upload.
- GitHub Release upload.

The example `examples/sdkwork-claw-router/sdkwork.workflow.json` maps these into:

- `dependencies` for appbase/core/ui/im-sdk/sdk-generator.
- `toolchains` for Node, pnpm, Python, Rust, and WiX.
- lifecycle commands for install, build, stage, package, and validate.
- targets for Linux, Windows, macOS, desktop/server/container packages.

The per-application workflow shrinks to a reusable workflow call.

## Standards Alignment

The design aligns with current GitHub Actions practices:

- Reusable workflows for centralized orchestration.
- Composite actions for reusable local workflow steps.
- Minimal explicit permissions.
- `id-token: write` for OIDC-capable deployment actions.
- Artifact attestations with build provenance.
- `concurrency` to prevent accidental overlapping releases.
- `actions/checkout@v4`, setup actions, and artifact v4.
- Matrix generation in code with tests instead of duplicated YAML.

## Error Handling

- Config validation fails before package jobs start.
- Matrix selection fails if filters select no targets.
- Dependency checkout fails on missing repository/path/ref.
- Lifecycle execution stops on the first failed step.
- Upload steps use `if-no-files-found: error`.
- Application-specific package validation remains a mandatory lifecycle phase for production-grade apps.

## Tradeoffs

Dynamic lifecycle commands cannot use GitHub's native `uses:` syntax because Actions does not support dynamically generated steps. The framework therefore rejects lifecycle `uses:` entries and executes declared `run` commands through a controlled Node runner. Shared workflow behavior that genuinely needs `uses:` remains in framework-level composite actions.

Application-specific package builders stay in application repositories. This keeps the framework generic and avoids embedding assumptions about Tauri, Flutter, Gradle, Docker, Helm, or custom SDKWork packaging internals.
