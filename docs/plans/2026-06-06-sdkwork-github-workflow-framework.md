# SDKWork GitHub Workflow Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reusable GitHub Actions workflow framework that standardizes SDKWork application packaging across server, desktop, mobile, web, and container targets.

**Architecture:** Applications declare `sdkwork.workflow.json`; this framework validates the config, resolves matrices, checks out dependencies, sets up toolchains, runs lifecycle commands, and publishes artifacts through a reusable workflow. The core logic lives in a tested zero-dependency Node planner rather than copied YAML.

**Tech Stack:** GitHub Actions reusable workflows, composite actions, Node ESM, JSON Schema, Node test runner.

---

### Task 1: Core Planner

**Files:**
- Create: `scripts/sdkwork-workflow.mjs`
- Test: `tests/sdkwork-workflow.test.mjs`

- [x] Write failing tests for config validation.
- [x] Write failing tests for matrix filtering.
- [x] Implement `validateWorkflowConfig`.
- [x] Implement `createPackageMatrix`.
- [x] Implement `loadWorkflowConfig`.
- [x] Implement secret-like redaction.
- [x] Run `npm test`.

### Task 2: Lifecycle Runner

**Files:**
- Modify: `scripts/sdkwork-workflow.mjs`
- Modify: `tests/sdkwork-workflow.test.mjs`

- [x] Write failing tests for lifecycle plan creation.
- [x] Implement `createLifecyclePlan`.
- [x] Write failing tests for lifecycle execution.
- [x] Implement `runLifecyclePlan`.
- [x] Run `npm test`.

### Task 3: Configuration Contract

**Files:**
- Create: `schemas/sdkwork-workflow.schema.json`
- Create: `examples/sdkwork-claw-router/sdkwork.workflow.json`
- Create: `examples/mobile-flutter/sdkwork.workflow.json`

- [x] Create schema v1.
- [x] Map `sdkwork-claw-router` workflow concepts into example config.
- [x] Add mobile Flutter example.
- [x] Test examples with `validateWorkflowConfig`.

### Task 4: GitHub Actions Framework

**Files:**
- Create: `.github/workflows/sdkwork-package.yml`
- Create: `actions/validate-config/action.yml`
- Create: `actions/checkout-dependencies/action.yml`
- Create: `actions/setup-toolchains/action.yml`
- Create: `actions/run-lifecycle/action.yml`
- Create: `actions/publish-release/action.yml`
- Create: `templates/app-package.workflow.yml`

- [x] Create reusable workflow.
- [x] Create config validation action.
- [x] Create dependency checkout action.
- [x] Create toolchain setup action.
- [x] Create lifecycle runner action.
- [x] Create release publish action.
- [x] Create app entrypoint template.

### Task 5: Documentation and Verification

**Files:**
- Create: `README.md`
- Create: `docs/design/sdkwork-github-workflow-framework.md`
- Modify: repository metadata

- [x] Document application integration.
- [x] Document lifecycle contract.
- [x] Document dependency contract.
- [x] Document standards alignment.
- [ ] Run full local verification.
- [ ] Initialize git repository if missing.
- [ ] Commit framework implementation.

### Task 6: Deployment and Supply Chain Enhancements

**Files:**
- Modify: `scripts/sdkwork-workflow.mjs`
- Modify: `schemas/sdkwork-workflow.schema.json`
- Modify: `.github/workflows/sdkwork-package.yml`
- Modify: `actions/run-lifecycle/action.yml`
- Modify: `examples/sdkwork-claw-router/sdkwork.workflow.json`
- Modify: `examples/mobile-flutter/sdkwork.workflow.json`
- Modify: `tests/sdkwork-workflow.test.mjs`

- [x] Write failing tests for deployment matrix planning.
- [x] Implement deployment validation and matrix planning.
- [x] Add deployment lifecycle environment injection.
- [x] Add `sign`, `sbom`, `deploy`, and `publish` lifecycle phases.
- [x] Extend reusable workflow with optional deployment jobs.
- [x] Bind deployment jobs to GitHub Environments.
- [x] Update examples for production deployment/store publishing.
- [ ] Run full local verification.
- [ ] Commit deployment enhancements.

### Task 7: Tablet Packaging

**Files:**
- Modify: `scripts/sdkwork-workflow.mjs`
- Modify: `schemas/sdkwork-workflow.schema.json`
- Modify: `templates/app-package.workflow.yml`
- Create: `examples/tablet-cross-platform/sdkwork.workflow.json`
- Modify: `tests/sdkwork-workflow.test.mjs`

- [x] Write failing tests for tablet profile and tablet platforms.
- [x] Add `tablet` profile.
- [x] Add `ipados`, `android-tablet`, and `windows-tablet` platforms.
- [x] Add `msix` package format.
- [x] Add tablet example config.
- [ ] Run full local verification.
- [ ] Commit tablet packaging enhancements.
