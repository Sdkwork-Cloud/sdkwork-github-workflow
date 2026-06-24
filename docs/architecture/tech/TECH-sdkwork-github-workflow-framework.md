> Migrated from `docs/design/sdkwork-github-workflow-framework.md` on 2026-06-24.
> Owner: SDKWork maintainers

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
- `targets`: deployment profile, runtime target, package profile, platform, architecture, formats, runner, output globs.
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

The framework keeps deployment architecture, runtime location, and package taxonomy separate.

Deployment profiles are:

- `standalone`
- `cloud`

Runtime targets are:

- `browser`
- `desktop`
- `tablet-ipados`
- `tablet-android`
- `capacitor-ios`
- `capacitor-android`
- `flutter-ios`
- `flutter-android`
- `android-native`
- `ios-native`
- `harmony-native`
- `mini-program`
- `server`
- `container`
- `test-runner`

Package profiles are:

- `server`
- `desktop`
- `mobile`
- `tablet`
- `browser`
- `mini-program`
- `container`
- `worker`
- `library`
- `test`

The framework supports these platforms:

- `web`
- `h5`
- `h5-weixin`
- `linux`
- `windows`
- `macos`
- `android`
- `android-tablet`
- `ios`
- `ipados`
- `windows-tablet`
- `harmony`
- `container`
- `mp-weixin`
- `mp-alipay`
- `mp-baidu`
- `mp-toutiao`
- `mp-lark`
- `mp-qq`
- `mp-kuaishou`
- `mp-jd`
- `mp-360`
- `mp-dingtalk`
- `mp-ali`
- `test`

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
- Windows native: `msi`, `msix`, `exe`
- Container: `docker`, `oci`, `helm`
- Mobile: `apk`, `aab`, `ipa`
- Tablet: `apk`, `aab`, `ipa`, `msix`
- Browser/mini-program/JVM: `web`, `web-url`, `static`, `mini-program-package`, `jar`, `war`

Package ids use `<platform>-<architecture>-<deployment-profile>-<profile>-<format-token>`. Linux native `deb` and `rpm` packages insert the distribution segment after `linux`. Docker-compatible artifacts use `runtimeTarget = "container"` and a container format such as `oci` or `docker`; `docker` is not a deployment profile, runtime target, or package profile.

## Migration From sdkwork-claw-router

The original workflow contains these framework-level concepts:

- Git tag and release triggers for standard package/deploy entrypoints.
- `workflow_dispatch` inputs for tag/version/deployment profile/runtime target/platform/architecture/profile/format.
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
- lifecycle commands for sign, sbom, deploy, and publish.
- targets for Linux, Windows, macOS, desktop/server/container packages.
- deployments for production server rollout and desktop/mobile store publishing.

The per-application workflow shrinks to a reusable workflow call with standardized tag push, release publish, and manual dispatch triggers.

## Standards Alignment

The design aligns with current GitHub Actions practices:

- Reusable workflows for centralized orchestration.
- Composite actions for reusable local workflow steps.
- Minimal explicit permissions.
- `id-token: write` for OIDC-capable deployment actions.
- Artifact attestations with build provenance.
- Toolchain setup consumes every declared planner output, including .NET, Android SDK, and Xcode.
- Policy validation that turns required signing and SBOM declarations into mandatory lifecycle hooks.
- GitHub Environments for deployment approvals, URLs, and environment-scoped secrets.
- `concurrency` to prevent accidental overlapping releases.
- `actions/checkout@v4`, setup actions, and artifact v4.
- Matrix generation in code with tests instead of duplicated YAML.
- Shell-based actions read workflow/action inputs from environment variables before command execution.

## Error Handling

- Config validation fails before package jobs start.
- Planner validation rejects schema-declared type mismatches, empty target lists, duplicate target formats, and unsupported fields before matrix jobs are created.
- Required signing and SBOM policies fail validation if their lifecycle hooks are missing.
- Matrix selection fails if filters select no targets.
- Dependency checkout fails on missing repository/path/ref.
- Dependency checkout path overlaps with the application source or framework checkout fail validation before checkout.
- Dependency ref JSON workflow input is passed through an environment variable before shell execution.
- Deployment selectors that match no package target fail validation before deployment matrix generation.
- Lifecycle execution stops on the first failed step.
- Deployment jobs are optional and only run when the caller passes `deploy: true`.
- Deployment jobs bind to the configured GitHub Environment.
- Upload steps use `if-no-files-found: error`.
- Application-specific package validation remains a mandatory lifecycle phase for production-grade apps.
- Publication and provenance steps are driven by resolved config policy as well as caller inputs: `publish.workflowArtifact`, `publish.githubRelease`, `publish.retentionDays`, and `security.artifactAttestations` must affect the reusable workflow execution path.
- Deployment lifecycle execution receives deployment environment, URL, and lifecycle values explicitly so local lifecycle plans and GitHub deployment jobs share the same context contract.

## Tradeoffs

Dynamic lifecycle commands cannot use GitHub's native `uses:` syntax because Actions does not support dynamically generated steps. The framework therefore rejects lifecycle `uses:` entries and executes declared `run` commands through a controlled Node runner. Shared workflow behavior that genuinely needs `uses:` remains in framework-level composite actions.

Application-specific package builders stay in application repositories. This keeps the framework generic and avoids embedding assumptions about Tauri, Flutter, Gradle, Docker, Helm, or custom SDKWork packaging internals.

