#!/usr/bin/env node

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createReadStream, existsSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCHEMA_VERSION = '2026-06-06.sdkwork.workflow.v1';
const SUPPORTED_DEPLOYMENT_PROFILES = Object.freeze(['standalone', 'cloud']);
const SUPPORTED_PROFILE_BINDINGS = Object.freeze(['fixed', 'runtime-configurable', 'non-deployable']);
const SUPPORTED_RUNTIME_TARGETS = Object.freeze([
  'browser',
  'desktop',
  'tablet-ipados',
  'tablet-android',
  'capacitor-ios',
  'capacitor-android',
  'flutter-ios',
  'flutter-android',
  'android-native',
  'ios-native',
  'harmony-native',
  'mini-program',
  'server',
  'container',
  'test-runner',
]);
const SUPPORTED_PROFILES = Object.freeze([
  'browser',
  'desktop',
  'mobile',
  'tablet',
  'mini-program',
  'server',
  'container',
  'worker',
  'library',
  'test',
]);
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;
const PACKAGE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
const LOWER_KEBAB_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const SUPPORTED_PLATFORMS = Object.freeze([
  'web',
  'h5',
  'h5-weixin',
  'linux',
  'windows',
  'macos',
  'ios',
  'ipados',
  'android',
  'android-tablet',
  'windows-tablet',
  'harmony',
  'container',
  'mp-weixin',
  'mp-alipay',
  'mp-baidu',
  'mp-toutiao',
  'mp-lark',
  'mp-qq',
  'mp-kuaishou',
  'mp-jd',
  'mp-360',
  'mp-dingtalk',
  'mp-ali',
  'test',
]);
const SUPPORTED_CLIENT_ARCHITECTURES = Object.freeze([
  'pc-web',
  'h5',
  'capacitor',
  'flutter',
  'tauri',
  'electron',
  'android-native',
  'ios-native',
  'harmony-native',
  'mini-program',
]);
const SUPPORTED_ARCHITECTURES = Object.freeze(['x64', 'arm64', 'armv7', 'universal', 'wasm32', 'noarch']);
const SUPPORTED_DEB_DISTRIBUTIONS = Object.freeze(['debian', 'ubuntu']);
const SUPPORTED_RPM_DISTRIBUTIONS = Object.freeze(['rhel', 'centos', 'fedora', 'opensuse', 'suse']);
const SUPPORTED_LINUX_DISTRIBUTIONS = Object.freeze([
  ...SUPPORTED_DEB_DISTRIBUTIONS,
  ...SUPPORTED_RPM_DISTRIBUTIONS,
]);
const PACKAGE_VARIANT_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
const SUPPORTED_FORMATS = Object.freeze([
  'zip',
  'tar.gz',
  'deb',
  'rpm',
  'pkg',
  'dmg',
  'msi',
  'msix',
  'exe',
  'appimage',
  'snap',
  'flatpak',
  'docker',
  'oci',
  'helm',
  'apk',
  'aab',
  'ipa',
  'web',
  'web-url',
  'static',
  'mini-program-package',
  'jar',
  'war',
  'other',
]);
const PROFILE_RUNTIME_TARGETS = Object.freeze({
  browser: ['browser'],
  desktop: ['desktop'],
  mobile: [
    'browser',
    'capacitor-ios',
    'capacitor-android',
    'flutter-ios',
    'flutter-android',
    'android-native',
    'ios-native',
    'harmony-native',
  ],
  tablet: ['tablet-ipados', 'tablet-android', 'desktop'],
  'mini-program': ['mini-program'],
  server: ['server'],
  container: ['container'],
  worker: ['server', 'container'],
  library: ['browser', 'server', 'container', 'test-runner'],
  test: ['test-runner'],
});
const RUNTIME_CONFIGURABLE_RUNTIME_TARGETS = Object.freeze([
  'browser',
  'desktop',
  'tablet-ipados',
  'tablet-android',
  'capacitor-ios',
  'capacitor-android',
  'flutter-ios',
  'flutter-android',
  'android-native',
  'ios-native',
  'harmony-native',
  'mini-program',
]);
const SECRET_VALUE_PATTERNS = Object.freeze([
  /^gh[pousr]_[0-9A-Za-z_]{8,}$/u,
  /^github_pat_[0-9A-Za-z_]+$/u,
  /^sk-[0-9A-Za-z_-]{12,}$/u,
  /^[A-Za-z0-9+/]{32,}={0,2}$/u,
]);
const LIFECYCLE_PHASES = Object.freeze([
  'preflight',
  'install',
  'build',
  'stage',
  'package',
  'sign',
  'sbom',
  'validate',
  'deploy',
  'publish',
]);
const SUPPORTED_DEPENDENCY_TOKEN_SECRET = 'SDKWORK_RELEASE_TOKEN';
const ROOT_CONFIG_KEYS = Object.freeze([
  '$schema',
  'schemaVersion',
  'app',
  'release',
  'dependencies',
  'verificationDependencies',
  'toolchains',
  'lifecycle',
  'targets',
  'security',
  'publish',
  'deployments',
]);
const APP_CONFIG_KEYS = Object.freeze(['id', 'name', 'repository', 'sourcePath', 'configPath']);
const RELEASE_CONFIG_KEYS = Object.freeze(['artifactPrefix', 'defaultVersion', 'versionInput', 'tagInput', 'channelInput', 'changelog']);
const DEPENDENCY_CONFIG_KEYS = Object.freeze(['id', 'repository', 'ref', 'refInput', 'path', 'tokenSecret', 'submodules']);
const VERIFICATION_DEPENDENCY_CONFIG_KEYS = Object.freeze([
  ...DEPENDENCY_CONFIG_KEYS,
  'purpose',
]);
const TOOLCHAIN_CONFIG_KEYS = Object.freeze(['node', 'pnpm', 'python', 'java', 'go', 'rust', 'flutter', 'dotnet', 'android', 'xcode', 'wix']);
const TOOLCHAIN_STRING_KEYS = Object.freeze(['node', 'pnpm', 'python', 'java', 'go', 'rust', 'flutter', 'dotnet', 'wix']);
const TOOLCHAIN_BOOLEAN_KEYS = Object.freeze(['android', 'xcode']);
const LIFECYCLE_STEP_KEYS = Object.freeze(['name', 'run', 'shell', 'workingDirectory', 'env']);
const TARGET_CONFIG_KEYS = Object.freeze([
  'id',
  'packageId',
  'profileBinding',
  'deploymentProfile',
  'supportedDeploymentProfiles',
  'defaultDeploymentProfile',
  'runtimeTarget',
  'targetPlatform',
  'clientArchitecture',
  'profile',
  'platform',
  'distribution',
  'architecture',
  'variant',
  'formats',
  'runner',
  'outputGlobs',
  'artifactPath',
  'environment',
  'signing',
]);
const SECURITY_CONFIG_KEYS = Object.freeze(['oidcRequired', 'artifactAttestations', 'sbomRequired', 'signingRequired']);
const PUBLISH_CONFIG_KEYS = Object.freeze([
  'workflowArtifact',
  'githubRelease',
  'aggregateRelease',
  'aggregateArtifactPath',
  'aggregateUploadGlobs',
  'retentionDays',
]);
const DEPLOYMENT_CONFIG_KEYS = Object.freeze([
  'id',
  'environment',
  'url',
  'runner',
  'deploymentProfile',
  'runtimeTarget',
  'profile',
  'platform',
  'architecture',
  'variant',
  'format',
  'targetId',
  'packageId',
  'artifactEvidencePath',
  'lifecycle',
]);
const CHANGELOG_CONFIG_KEYS = Object.freeze(['enabled', 'source', 'path', 'includeCommitSubjects', 'maxCommitSubjects']);
const SUPPORTED_CHANGELOG_SOURCES = Object.freeze(['auto', 'app-manifest', 'file', 'git', 'none']);
const FRAMEWORK_CHECKOUT_PATH = '.sdkwork/github-workflow';
const WORKFLOW_ARTIFACT_PREFIX = 'sdkwork';
const WORKFLOW_CLI_PATH = fileURLToPath(import.meta.url);

function printHelp() {
  console.log(`Usage: node scripts/sdkwork-workflow.mjs <command> [options]

Commands:
  validate       Validate an sdkwork.workflow.json file.
  matrix         Render the selected GitHub Actions package matrix.
  deployments    Render deployment matrix from selected package targets.
  dependencies   Render dependency checkout metadata.
  toolchains     Render declared toolchain setup metadata.
  changelog      Render release changelog / GitHub Release notes.
  lifecycle      Render one lifecycle phase execution plan.
  evidence       Verify artifact evidence against one selected package target.
  evidence:create Create artifact evidence from a packaged file and references.
  init-app       Generate sdkwork.workflow.json and package workflow for an app.

Options:
  --config <path>        Config path (default sdkwork.workflow.json).
  --deployment-profile <value>
                         Deployment profile filter, or all.
  --runtime-target <value>
                         Runtime target filter, or all.
  --platform <value>     Platform filter, or all.
  --architecture <value> Architecture filter, or all.
  --profile <value>      Profile filter, or all.
  --variant <value>      Package variant filter, or all.
  --format <value>       Package format filter, or all.
  --version <value>      Release/package version override.
  --phase <value>        Lifecycle phase for lifecycle command.
  --target-id <value>    Matrix target id for lifecycle command.
  --release-tag <value>  Release tag exposed to lifecycle steps.
  --deploy-environment <value>
                         Deployment environment exposed to lifecycle steps.
  --deploy-url <value>   Deployment URL exposed to lifecycle steps.
  --deploy-lifecycle <value>
                         Deployment lifecycle label exposed to lifecycle steps.
  --artifact-evidence <path>
                         Artifact evidence document for the evidence command.
  --artifact <path>      Primary packaged artifact path relative to --artifact-root.
  --artifact-root <path> Root directory containing the packaged artifact.
  --artifact-id <value> Stable artifact identity for evidence:create.
  --sbom <value>         SBOM reference for evidence:create.
  --provenance <value>   Provenance reference for evidence:create.
  --signature <value>    Signature reference for evidence:create.
  --source-commit <sha>  Expected source commit for evidence validation/generation.
  --aggregate-release <true|false>
                         Use aggregate GitHub Release lifecycle context.
  --output <path>         Output path for changelog command.
  --dependency-refs-json <json>
                         JSON object mapping dependency ref input names to refs.
  --dependency-refs-file <path>
                         JSON file mapping dependency ref input names to refs.
  --root <path>           Application repository root for init-app.
  --app-id <value>        Application id for init-app.
  --app-name <value>      Application display name for init-app.
  --repository <owner/repo>
                         Application GitHub repository for init-app.
  --profiles <csv>        Comma-separated profiles for init-app.
  --framework-ref <ref>   Framework ref used by generated package workflow.
  --force                Overwrite generated files in init-app.
  --run                  Execute lifecycle phase instead of only rendering it.
  --json                 Print JSON.
  --github-output        Append machine outputs to GITHUB_OUTPUT.
  -h, --help             Show help.
`);
}

function parseArgs(argv = process.argv.slice(2)) {
  const command = argv[0] && !argv[0].startsWith('-') ? argv[0] : 'help';
  const settings = {
    command,
    configPath: 'sdkwork.workflow.json',
    deploymentProfile: 'all',
    runtimeTarget: 'all',
    platform: 'all',
    architecture: 'all',
    profile: 'all',
    variant: 'all',
    format: 'all',
    version: null,
    phase: null,
    targetId: null,
    releaseTag: null,
    deployEnvironment: null,
    deployUrl: null,
    deployLifecycle: null,
    artifactEvidencePath: null,
    artifactPath: null,
    artifactRoot: '.',
    artifactId: null,
    sbomReference: null,
    provenanceReference: null,
    signatureReference: null,
    sourceCommit: null,
    aggregateRelease: false,
    outputPath: '.sdkwork/release/release-notes.md',
    dependencyRefsJson: null,
    dependencyRefsFile: null,
    root: '.',
    appId: null,
    appName: null,
    repository: null,
    profiles: 'server',
    frameworkRef: 'v1',
    force: false,
    run: false,
    json: false,
    githubOutput: false,
    help: command === 'help',
  };

  const start = command === 'help' ? 0 : 1;
  for (let index = start; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--config':
        settings.configPath = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--deployment-profile':
        settings.deploymentProfile = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--runtime-target':
        settings.runtimeTarget = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--platform':
        settings.platform = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--architecture':
        settings.architecture = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--profile':
        settings.profile = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--variant':
        settings.variant = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--format':
        settings.format = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--version':
        settings.version = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--phase':
        settings.phase = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--target-id':
        settings.targetId = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--release-tag':
        settings.releaseTag = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--deploy-environment':
        settings.deployEnvironment = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--deploy-url':
        settings.deployUrl = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--deploy-lifecycle':
        settings.deployLifecycle = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--artifact-evidence':
        settings.artifactEvidencePath = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--artifact':
        settings.artifactPath = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--artifact-root':
        settings.artifactRoot = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--artifact-id':
        settings.artifactId = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--sbom':
        settings.sbomReference = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--provenance':
        settings.provenanceReference = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--signature':
        settings.signatureReference = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--source-commit':
        settings.sourceCommit = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--aggregate-release':
        settings.aggregateRelease = parseBooleanOption(requireValue(argv, index, arg), arg);
        index += 1;
        break;
      case '--output':
        settings.outputPath = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--dependency-refs-json':
        settings.dependencyRefsJson = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--dependency-refs-file':
        settings.dependencyRefsFile = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--root':
        settings.root = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--app-id':
        settings.appId = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--app-name':
        settings.appName = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--repository':
        settings.repository = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--profiles':
        settings.profiles = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--framework-ref':
        settings.frameworkRef = requireValue(argv, index, arg);
        index += 1;
        break;
      case '--json':
        settings.json = true;
        break;
      case '--run':
        settings.run = true;
        break;
      case '--force':
        settings.force = true;
        break;
      case '--github-output':
        settings.githubOutput = true;
        break;
      case '--help':
      case '-h':
        settings.help = true;
        break;
      default:
        throw new Error(`Unsupported option: ${arg}`);
    }
  }

  return settings;
}

function requireValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseBooleanOption(value, flag) {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  throw new Error(`${flag} must be true or false`);
}

async function loadWorkflowConfig(configPath = 'sdkwork.workflow.json') {
  const absolutePath = path.resolve(configPath);
  const raw = await readFile(absolutePath, 'utf8');
  try {
    return JSON.parse(stripJsonComments(raw));
  } catch (error) {
    throw new Error(`Invalid workflow config JSON at ${absolutePath}: ${error.message}`);
  }
}

function stripJsonComments(source) {
  let result = '';
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (inLineComment) {
      if (char === '\n' || char === '\r') {
        inLineComment = false;
        result += char;
      }
      continue;
    }
    if (inBlockComment) {
      if (char === '*' && next === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }
    if (inString) {
      result += char;
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }
    if (char === '/' && next === '/') {
      inLineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }
    result += char;
  }

  return result;
}

function validateWorkflowConfig(config) {
  const issues = [];
  if (!isPlainObject(config)) {
    return ['config must be a JSON object'];
  }
  validateKnownProperties(config, '', ROOT_CONFIG_KEYS, issues);
  if (config.schemaVersion !== SCHEMA_VERSION) {
    issues.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  }

  validateObject(config.app, 'app', issues);
  validateKnownProperties(config.app, 'app', APP_CONFIG_KEYS, issues);
  validateRequiredString(config.app?.id, 'app.id', issues, { pattern: ID_PATTERN });
  validateOptionalString(config.app?.name, 'app.name', issues);
  validateRequiredString(config.app?.repository, 'app.repository', issues, { pattern: REPOSITORY_PATTERN });
  validateOptionalSafeRelativePath(config.app?.sourcePath, 'app.sourcePath', issues);
  validateOptionalSafeRelativePath(config.app?.configPath, 'app.configPath', issues);

  validateObject(config.release, 'release', issues);
  validateKnownProperties(config.release, 'release', RELEASE_CONFIG_KEYS, issues);
  validateRequiredString(config.release?.artifactPrefix, 'release.artifactPrefix', issues, {
    pattern: PACKAGE_ID_PATTERN,
  });
  if (config.release?.defaultVersion !== undefined) {
    validateRequiredString(config.release.defaultVersion, 'release.defaultVersion', issues, {
      pattern: /^[0-9A-Za-z][0-9A-Za-z._+-]*$/u,
    });
  }
  validateOptionalString(config.release?.versionInput, 'release.versionInput', issues, {
    pattern: /^[A-Za-z_][A-Za-z0-9_]*$/u,
  });
  validateOptionalString(config.release?.tagInput, 'release.tagInput', issues, {
    pattern: /^[A-Za-z_][A-Za-z0-9_]*$/u,
  });
  validateOptionalString(config.release?.channelInput, 'release.channelInput', issues, {
    pattern: /^[A-Za-z_][A-Za-z0-9_]*$/u,
  });
  if (config.release?.changelog !== undefined) {
    validateChangelog(config.release.changelog, issues);
  }

  if (config.dependencies !== undefined) {
    validateArray(config.dependencies, 'dependencies', issues);
    if (Array.isArray(config.dependencies)) {
      config.dependencies.forEach((dependency, index) =>
        validateDependency(dependency, index, issues, { appSourcePath: config.app?.sourcePath ?? '.' })
      );
    }
  }
  if (config.verificationDependencies !== undefined) {
    validateArray(config.verificationDependencies, 'verificationDependencies', issues);
    if (Array.isArray(config.verificationDependencies)) {
      config.verificationDependencies.forEach((dependency, index) =>
        validateDependency(dependency, index, issues, {
          appSourcePath: config.app?.sourcePath ?? '.',
          labelPrefix: 'verificationDependencies',
          allowedKeys: VERIFICATION_DEPENDENCY_CONFIG_KEYS,
          allowPurpose: true,
        })
      );
    }
  }

  if (config.toolchains !== undefined) {
    validateToolchains(config.toolchains, issues);
  }
  if (config.lifecycle !== undefined) {
    validateLifecycle(config.lifecycle, issues);
  }

  validateArray(config.targets, 'targets', issues, { minLength: 1 });
  if (Array.isArray(config.targets)) {
    const seenIds = new Set();
    const seenPackageIds = new Set();
    config.targets.forEach((target, index) => validateTarget(target, index, issues, seenIds, seenPackageIds));
  }

  if (config.security !== undefined) {
    validateSecurity(config.security, issues);
  }
  validateSecurityPolicy(config, issues);
  if (config.publish !== undefined) {
    validatePublish(config.publish, issues);
  }
  if (config.deployments !== undefined) {
    validateArray(config.deployments, 'deployments', issues);
    if (Array.isArray(config.deployments)) {
      const seenDeploymentIds = new Set();
      config.deployments.forEach((deployment, index) =>
        validateDeployment(deployment, index, issues, seenDeploymentIds)
      );
      validateDeploymentBindings(config.deployments, config.targets, issues);
      validateDeploymentLifecyclePolicy(config, issues);
    }
  }

  return issues;
}

function validateDeploymentLifecyclePolicy(config, issues) {
  for (const lifecycle of new Set(config.deployments.map((deployment) => deployment.lifecycle ?? 'deploy'))) {
    if (!hasLifecycleSteps(config.lifecycle?.[lifecycle])) {
      issues.push(`deployments using lifecycle.${lifecycle} require executable lifecycle.${lifecycle} steps`);
    }
  }
}

function validateDependency(
  dependency,
  index,
  issues,
  {
    appSourcePath = '.',
    labelPrefix = 'dependencies',
    allowedKeys = DEPENDENCY_CONFIG_KEYS,
    allowPurpose = false,
  } = {},
) {
  const label = `${labelPrefix}[${index}]`;
  validateObject(dependency, label, issues);
  validateKnownProperties(dependency, label, allowedKeys, issues);
  validateRequiredString(dependency?.id, `${label}.id`, issues, { pattern: ID_PATTERN });
  validateRequiredString(dependency?.repository, `${label}.repository`, issues, { pattern: REPOSITORY_PATTERN });
  validateOptionalGitRef(dependency?.ref, `${label}.ref`, issues);
  validateOptionalString(dependency?.refInput, `${label}.refInput`, issues, {
    pattern: /^[A-Za-z_][A-Za-z0-9_]*$/u,
  });
  validateOptionalSafeRelativePath(dependency?.path, `${label}.path`, issues);
  validateDependencyCheckoutPath(resolvedDependencyPath(dependency), label, issues, { appSourcePath });
  if (dependency?.tokenSecret !== undefined) {
    validateOptionalString(dependency.tokenSecret, `${label}.tokenSecret`, issues, {
      pattern: /^[A-Z_][A-Z0-9_]*$/u,
    });
    if (dependency.tokenSecret !== SUPPORTED_DEPENDENCY_TOKEN_SECRET) {
      issues.push(`${label}.tokenSecret only supports ${SUPPORTED_DEPENDENCY_TOKEN_SECRET}`);
    }
  }
  if (dependency?.submodules !== undefined && !['false', 'true', 'recursive'].includes(String(dependency.submodules))) {
    issues.push(`${label}.submodules must be false, true, or recursive`);
  }
  if (allowPurpose && dependency?.purpose !== undefined) {
    validateOptionalString(dependency.purpose, `${label}.purpose`, issues);
  }
}

function validateDependencyCheckoutPath(value, label, issues, { appSourcePath = '.' } = {}) {
  if (typeof value !== 'string' || value.trim() === '') {
    return;
  }
  if (pathsOverlap(value, appSourcePath || '.')) {
    issues.push(`${label}.path must not overlap app.sourcePath`);
  }
  if (pathsOverlap(value, FRAMEWORK_CHECKOUT_PATH)) {
    issues.push(`${label}.path must not overlap the framework checkout path`);
  }
}

function resolvedDependencyPath(dependency) {
  if (typeof dependency?.path === 'string' && dependency.path.trim() !== '') {
    return dependency.path;
  }
  if (typeof dependency?.id === 'string' && dependency.id.trim() !== '') {
    return `../${dependency.id}`;
  }
  return null;
}

function validateToolchains(toolchains, issues) {
  validateObject(toolchains, 'toolchains', issues);
  validateKnownProperties(toolchains, 'toolchains', TOOLCHAIN_CONFIG_KEYS, issues);
  for (const key of TOOLCHAIN_STRING_KEYS) {
    if (toolchains?.[key] !== undefined && typeof toolchains[key] !== 'string') {
      issues.push(`toolchains.${key} must be a string`);
    }
  }
  for (const key of TOOLCHAIN_BOOLEAN_KEYS) {
    if (toolchains?.[key] !== undefined && typeof toolchains[key] !== 'boolean') {
      issues.push(`toolchains.${key} must be a boolean`);
    }
  }
}

function validateLifecycle(lifecycle, issues) {
  validateObject(lifecycle, 'lifecycle', issues);
  validateKnownProperties(lifecycle, 'lifecycle', LIFECYCLE_PHASES, issues);
  for (const key of LIFECYCLE_PHASES) {
    if (lifecycle?.[key] !== undefined) {
      validateArray(lifecycle[key], `lifecycle.${key}`, issues);
      if (Array.isArray(lifecycle[key])) {
        lifecycle[key].forEach((step, index) => validateLifecycleStep(step, `lifecycle.${key}[${index}]`, issues));
      }
    }
  }
}

function validateLifecycleStep(step, label, issues) {
  validateObject(step, label, issues);
  validateKnownProperties(step, label, LIFECYCLE_STEP_KEYS, issues);
  if (step?.uses !== undefined) {
    issues.push(`${label}.uses is not supported; shared actions must be implemented in the framework, lifecycle steps must use run`);
  }
  if (!step?.run) {
    issues.push(`${label} must declare run`);
  }
  if (step?.run !== undefined) {
    validateRequiredString(step.run, `${label}.run`, issues);
  }
  validateOptionalString(step?.name, `${label}.name`, issues);
  if (step?.shell !== undefined && !['bash', 'pwsh', 'powershell', 'sh', 'cmd', 'node'].includes(String(step.shell))) {
    issues.push(`${label}.shell uses unsupported shell ${step.shell}`);
  }
  validateOptionalSafeRelativePath(step?.workingDirectory, `${label}.workingDirectory`, issues);
  if (step?.env !== undefined) {
    validateObject(step.env, `${label}.env`, issues);
    if (isPlainObject(step.env)) {
      for (const [key, value] of Object.entries(step.env)) {
        if (typeof value !== 'string') {
          issues.push(`${label}.env.${key} must be a string`);
        }
      }
    }
  }
}

function validateTarget(target, index, issues, seenIds, seenPackageIds) {
  const label = `targets[${index}]`;
  validateObject(target, label, issues);
  validateKnownProperties(target, label, TARGET_CONFIG_KEYS, issues);
  validateRequiredString(target?.id, `${label}.id`, issues, { pattern: PACKAGE_ID_PATTERN });
  if (target?.id) {
    if (seenIds.has(target.id)) {
      issues.push(`${label}.id is duplicated: ${target.id}`);
    }
    seenIds.add(target.id);
  }
  validateOptionalString(target?.packageId, `${label}.packageId`, issues, { pattern: PACKAGE_ID_PATTERN });
  validateTargetProfileBinding(target, label, issues);
  validateEnum(target?.runtimeTarget, `${label}.runtimeTarget`, SUPPORTED_RUNTIME_TARGETS, issues);
  validateTargetClientAxes(target, label, issues);
  validateEnum(target?.profile, `${label}.profile`, SUPPORTED_PROFILES, issues);
  validateEnum(target?.platform, `${label}.platform`, SUPPORTED_PLATFORMS, issues);
  if (target?.distribution !== undefined) {
    validateEnum(target.distribution, `${label}.distribution`, SUPPORTED_LINUX_DISTRIBUTIONS, issues);
  }
  validateEnum(target?.architecture, `${label}.architecture`, SUPPORTED_ARCHITECTURES, issues);
  validateOptionalString(target?.variant, `${label}.variant`, issues, { pattern: PACKAGE_VARIANT_PATTERN });
  validateArray(target?.formats, `${label}.formats`, issues, { minLength: 1 });
  if (Array.isArray(target?.formats)) {
    if (new Set(target.formats).size !== target.formats.length) {
      issues.push(`${label}.formats must not contain duplicate values`);
    }
    target.formats.forEach((format, formatIndex) =>
      validateEnum(format, `${label}.formats[${formatIndex}]`, SUPPORTED_FORMATS, issues)
    );
  }
  validateLinuxDistribution(target, label, issues);
  validateTargetRuntimeConsistency(target, label, issues);
  validateTargetId(target, label, issues);
  validateTargetPackageId(target, label, issues);
  validateUniquePackageIds(target, label, issues, seenPackageIds);
  validateRequiredString(target?.runner, `${label}.runner`, issues);
  validateArray(target?.outputGlobs, `${label}.outputGlobs`, issues, { minLength: 1 });
  if (Array.isArray(target?.outputGlobs)) {
    target.outputGlobs.forEach((glob, globIndex) =>
      validateOutputGlob(glob, `${label}.outputGlobs[${globIndex}]`, issues)
    );
  }
  validateOptionalSafeRelativePath(target?.artifactPath, `${label}.artifactPath`, issues);
  if (target?.environment !== undefined) {
    validateOptionalString(target.environment, `${label}.environment`, issues);
  }
  if (target?.signing !== undefined && typeof target.signing !== 'boolean') {
    issues.push(`${label}.signing must be a boolean`);
  }
}

function validateTargetClientAxes(target, label, issues) {
  if (target?.targetPlatform !== undefined) {
    validateEnum(target.targetPlatform, `${label}.targetPlatform`, SUPPORTED_PLATFORMS, issues);
    if (typeof target.platform === 'string' && target.targetPlatform !== target.platform) {
      issues.push(`${label}.targetPlatform must equal platform`);
    }
  }
  if (target?.clientArchitecture !== undefined) {
    validateEnum(
      target.clientArchitecture,
      `${label}.clientArchitecture`,
      SUPPORTED_CLIENT_ARCHITECTURES,
      issues,
    );
    if (!RUNTIME_CONFIGURABLE_RUNTIME_TARGETS.includes(target.runtimeTarget)) {
      issues.push(`${label}.clientArchitecture is valid only for client runtime targets`);
    }
  }
  if ((target?.targetPlatform === undefined) !== (target?.clientArchitecture === undefined)) {
    issues.push(`${label}.targetPlatform and clientArchitecture must be declared together for client metadata`);
  }
}

function targetProfileBinding(target) {
  return target?.profileBinding ?? (target?.deploymentProfile ? 'fixed' : undefined);
}

function validateTargetProfileBinding(target, label, issues) {
  const binding = targetProfileBinding(target);
  if (!binding) {
    issues.push(`${label}.deploymentProfile is required unless profileBinding is declared`);
    return;
  }
  validateEnum(binding, `${label}.profileBinding`, SUPPORTED_PROFILE_BINDINGS, issues);
  if (!SUPPORTED_PROFILE_BINDINGS.includes(binding)) {
    return;
  }

  if (binding === 'fixed') {
    validateEnum(target?.deploymentProfile, `${label}.deploymentProfile`, SUPPORTED_DEPLOYMENT_PROFILES, issues);
    if (target?.supportedDeploymentProfiles !== undefined) {
      issues.push(`${label}.supportedDeploymentProfiles must be omitted for fixed targets`);
    }
    if (target?.defaultDeploymentProfile !== undefined) {
      issues.push(`${label}.defaultDeploymentProfile must be omitted for fixed targets`);
    }
    return;
  }

  if (target?.deploymentProfile !== undefined) {
    issues.push(`${label}.deploymentProfile must be omitted for ${binding} targets`);
  }

  if (binding === 'runtime-configurable') {
    validateArray(target?.supportedDeploymentProfiles, `${label}.supportedDeploymentProfiles`, issues, { minLength: 2 });
    if (Array.isArray(target?.supportedDeploymentProfiles)) {
      const supported = target.supportedDeploymentProfiles;
      supported.forEach((profile, profileIndex) =>
        validateEnum(profile, `${label}.supportedDeploymentProfiles[${profileIndex}]`, SUPPORTED_DEPLOYMENT_PROFILES, issues)
      );
      if (supported.length !== 2 || new Set(supported).size !== 2
        || !SUPPORTED_DEPLOYMENT_PROFILES.every((profile) => supported.includes(profile))) {
        issues.push(`${label}.supportedDeploymentProfiles must contain exactly standalone and cloud`);
      }
    }
    validateEnum(target?.defaultDeploymentProfile, `${label}.defaultDeploymentProfile`, SUPPORTED_DEPLOYMENT_PROFILES, issues);
    if (SUPPORTED_DEPLOYMENT_PROFILES.includes(target?.defaultDeploymentProfile)
      && Array.isArray(target?.supportedDeploymentProfiles)
      && !target.supportedDeploymentProfiles.includes(target.defaultDeploymentProfile)) {
      issues.push(`${label}.defaultDeploymentProfile must be listed in supportedDeploymentProfiles`);
    }
    if (!RUNTIME_CONFIGURABLE_RUNTIME_TARGETS.includes(target?.runtimeTarget)) {
      issues.push(`${label}.runtimeTarget must be a client runtime target for runtime-configurable binding`);
    }
    return;
  }

  if (target?.supportedDeploymentProfiles !== undefined) {
    issues.push(`${label}.supportedDeploymentProfiles must be omitted for non-deployable targets`);
  }
  if (target?.defaultDeploymentProfile !== undefined) {
    issues.push(`${label}.defaultDeploymentProfile must be omitted for non-deployable targets`);
  }
  if (target?.runtimeTarget !== 'test-runner') {
    issues.push(`${label}.runtimeTarget must be test-runner for non-deployable binding`);
  }
}

function validateTargetRuntimeConsistency(target, label, issues) {
  if (typeof target?.profile !== 'string' || typeof target.runtimeTarget !== 'string') {
    return;
  }
  const supportedRuntimeTargets = PROFILE_RUNTIME_TARGETS[target.profile];
  if (!supportedRuntimeTargets || !supportedRuntimeTargets.includes(target.runtimeTarget)) {
    issues.push(`${label}.runtimeTarget ${target.runtimeTarget} is not valid for package profile ${target.profile}`);
  }
}

function validateLinuxDistribution(target, label, issues) {
  if (!Array.isArray(target?.formats) || target.formats.length === 0) {
    return;
  }

  const nativeFormats = target.formats.filter((format) => isLinuxNativePackageFormat(format));
  if (nativeFormats.length === 0) {
    if (target.distribution !== undefined) {
      issues.push(`${label}.distribution is only valid for linux deb or rpm packages`);
    }
    return;
  }

  if (target.platform !== 'linux') {
    issues.push(`${label}.platform must be linux for ${nativeFormats.join('/')} packages`);
  }
  if (nativeFormats.length !== target.formats.length || target.formats.length > 1) {
    issues.push(`${label}.formats must not mix linux native deb/rpm packages with other formats`);
    return;
  }

  const [format] = nativeFormats;
  if (typeof target.distribution !== 'string' || target.distribution.trim() === '') {
    issues.push(`${label}.distribution is required for linux ${format} packages`);
    return;
  }

  const supported = linuxDistributionsForFormat(format);
  if (!supported.includes(target.distribution)) {
    issues.push(`${label}.distribution ${target.distribution} is not valid for ${format} packages`);
  }
}

function validateTargetId(target, label, issues) {
  if (
    typeof target?.id !== 'string'
    || typeof target.platform !== 'string'
    || typeof target.architecture !== 'string'
    || typeof targetProfileToken(target) !== 'string'
    || typeof target.profile !== 'string'
    || !Array.isArray(target.formats)
    || target.formats.length === 0
  ) {
    return;
  }

  const expectedTargetId = target.formats.length === 1
    ? canonicalPackageIdForTarget(target, target.formats[0])
    : targetGroupIdForTarget(target);
  if (target.id !== expectedTargetId) {
    issues.push(`${label}.id must be ${expectedTargetId}`);
  }
}

function validateTargetPackageId(target, label, issues) {
  if (target?.packageId === undefined) {
    return;
  }
  if (
    typeof target.platform !== 'string'
    || typeof target.architecture !== 'string'
    || typeof targetProfileToken(target) !== 'string'
    || typeof target.profile !== 'string'
    || !Array.isArray(target.formats)
    || target.formats.length === 0
  ) {
    return;
  }
  if (target.formats.length > 1) {
    issues.push(`${label}.packageId must be omitted when formats contains multiple values`);
    return;
  }
  const expectedPackageId = canonicalPackageIdForTarget(target, target.formats[0]);
  if (target.packageId !== expectedPackageId) {
    issues.push(`${label}.packageId must be ${expectedPackageId}`);
  }
}

function validateUniquePackageIds(target, label, issues, seenPackageIds) {
  if (!Array.isArray(target?.formats) || target.formats.length === 0) {
    return;
  }
  if (
    typeof target.platform !== 'string'
    || typeof target.architecture !== 'string'
    || typeof targetProfileToken(target) !== 'string'
    || typeof target.profile !== 'string'
  ) {
    return;
  }
  for (const format of target.formats) {
    if (typeof format !== 'string') {
      continue;
    }
    const packageId = packageIdForTarget(target, format);
    if (!PACKAGE_ID_PATTERN.test(packageId)) {
      continue;
    }
    if (seenPackageIds.has(packageId)) {
      issues.push(`${label}.packageId is duplicated: ${packageId}`);
      continue;
    }
    seenPackageIds.add(packageId);
  }
}

function validateDeployment(deployment, index, issues, seenIds) {
  const label = `deployments[${index}]`;
  validateObject(deployment, label, issues);
  validateKnownProperties(deployment, label, DEPLOYMENT_CONFIG_KEYS, issues);
  validateRequiredString(deployment?.id, `${label}.id`, issues, { pattern: ID_PATTERN });
  if (deployment?.id) {
    if (seenIds.has(deployment.id)) {
      issues.push(`${label}.id is duplicated: ${deployment.id}`);
    }
    seenIds.add(deployment.id);
  }
  validateRequiredString(deployment?.environment, `${label}.environment`, issues, {
    pattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/u,
  });
  validateOptionalString(deployment?.runner, `${label}.runner`, issues);
  validateOptionalString(deployment?.url, `${label}.url`, issues);
  if (deployment?.deploymentProfile !== undefined) {
    validateEnum(deployment.deploymentProfile, `${label}.deploymentProfile`, SUPPORTED_DEPLOYMENT_PROFILES, issues);
  }
  if (deployment?.runtimeTarget !== undefined) {
    validateEnum(deployment.runtimeTarget, `${label}.runtimeTarget`, SUPPORTED_RUNTIME_TARGETS, issues);
  }
  if (deployment?.profile !== undefined) {
    validateEnum(deployment.profile, `${label}.profile`, SUPPORTED_PROFILES, issues);
  }
  if (deployment?.platform !== undefined) {
    validateEnum(deployment.platform, `${label}.platform`, SUPPORTED_PLATFORMS, issues);
  }
  if (deployment?.architecture !== undefined) {
    validateEnum(deployment.architecture, `${label}.architecture`, SUPPORTED_ARCHITECTURES, issues);
  }
  if (deployment?.variant !== undefined) {
    validateOptionalString(deployment.variant, `${label}.variant`, issues, { pattern: PACKAGE_VARIANT_PATTERN });
  }
  if (deployment?.format !== undefined) {
    validateEnum(deployment.format, `${label}.format`, SUPPORTED_FORMATS, issues);
  }
  if (deployment?.targetId !== undefined) {
    validateOptionalString(deployment.targetId, `${label}.targetId`, issues, { pattern: /^[a-z0-9][a-z0-9._-]*$/u });
  }
  if (deployment?.packageId !== undefined) {
    validateOptionalString(deployment.packageId, `${label}.packageId`, issues, { pattern: PACKAGE_ID_PATTERN });
  }
  if (deployment?.artifactEvidencePath !== undefined) {
    validateOptionalSafeRelativePath(deployment.artifactEvidencePath, `${label}.artifactEvidencePath`, issues);
    const unsupportedPlaceholders = String(deployment.artifactEvidencePath).match(/\{(?!packageId\}|targetId\})[^}]+\}/gu);
    if (unsupportedPlaceholders) {
      issues.push(`${label}.artifactEvidencePath contains unsupported placeholders: ${unsupportedPlaceholders.join(', ')}`);
    }
  }
  if (deployment?.lifecycle !== undefined && !['deploy', 'publish'].includes(String(deployment.lifecycle))) {
    issues.push(`${label}.lifecycle must be deploy or publish`);
  }
}

function validateDeploymentBindings(deployments, targets, issues) {
  if (!Array.isArray(deployments) || !Array.isArray(targets)) {
    return;
  }
  deployments.forEach((deployment, index) => {
    if (!isPlainObject(deployment)) {
      return;
    }
    if (!deploymentMatchesAnyTarget(deployment, targets)) {
      issues.push(`deployments[${index}] does not match any package target`);
    }
  });
}

function deploymentMatchesAnyTarget(deployment, targets) {
  for (const target of targets) {
    if (!isPlainObject(target) || !Array.isArray(target.formats)) {
      continue;
    }
    for (const format of target.formats) {
      if (deploymentMatchesPackage(deployment, {
        id: target.id,
        packageId: packageIdForTarget(target, format),
        profileBinding: targetProfileBinding(target),
        deploymentProfile: target.deploymentProfile,
        supportedDeploymentProfiles: target.supportedDeploymentProfiles,
        defaultDeploymentProfile: target.defaultDeploymentProfile,
        runtimeTarget: target.runtimeTarget,
        profile: target.profile,
        platform: target.platform,
        ...(target.distribution ? { distribution: target.distribution } : {}),
        architecture: target.architecture,
        ...(target.variant ? { variant: target.variant } : {}),
        format,
      })) {
        return true;
      }
    }
  }
  return false;
}

function validateSecurity(security, issues) {
  validateObject(security, 'security', issues);
  validateKnownProperties(security, 'security', SECURITY_CONFIG_KEYS, issues);
  for (const key of ['oidcRequired', 'artifactAttestations', 'sbomRequired', 'signingRequired']) {
    if (security?.[key] !== undefined && typeof security[key] !== 'boolean') {
      issues.push(`security.${key} must be a boolean`);
    }
  }
}

function validateSecurityPolicy(config, issues) {
  if (config.security?.signingRequired === true) {
    if (!hasLifecycleSteps(config.lifecycle?.sign)) {
      issues.push('security.signingRequired requires lifecycle.sign steps');
    } else if (config.lifecycle.sign.every(isNoOpLifecycleStep)) {
      issues.push('security.signingRequired requires an executable lifecycle.sign step, not logging-only placeholders');
    }
    if (Array.isArray(config.targets)) {
      config.targets.forEach((target, index) => {
        if (target?.signing === false) {
          issues.push(`targets[${index}].signing cannot be false when security.signingRequired is true`);
        }
      });
    }
  }
  if (config.security?.sbomRequired === true) {
    if (!hasLifecycleSteps(config.lifecycle?.sbom)) {
      issues.push('security.sbomRequired requires lifecycle.sbom steps');
    } else if (config.lifecycle.sbom.every(isNoOpLifecycleStep)) {
      issues.push('security.sbomRequired requires an executable lifecycle.sbom step, not logging-only placeholders');
    }
  }
}

function hasLifecycleSteps(steps) {
  return Array.isArray(steps) && steps.length > 0;
}

function isNoOpLifecycleStep(step) {
  const run = String(step?.run ?? '').trim().replace(/;+$/u, '').trim();
  return /^(?:echo|write-(?:host|output))\b[^\r\n]*$/iu.test(run)
    || /^console\.(?:log|info|warn)\([^\r\n]*\)$/u.test(run)
    || /^node\s+(?:--eval|-e)\s+["']console\.(?:log|info|warn)\([^\r\n]*\);?["']$/u.test(run);
}

function validatePublish(publish, issues) {
  validateObject(publish, 'publish', issues);
  validateKnownProperties(publish, 'publish', PUBLISH_CONFIG_KEYS, issues);
  if (publish?.githubRelease !== undefined && typeof publish.githubRelease !== 'boolean') {
    issues.push('publish.githubRelease must be a boolean');
  }
  if (publish?.workflowArtifact !== undefined && typeof publish.workflowArtifact !== 'boolean') {
    issues.push('publish.workflowArtifact must be a boolean');
  }
  if (publish?.aggregateRelease !== undefined && typeof publish.aggregateRelease !== 'boolean') {
    issues.push('publish.aggregateRelease must be a boolean');
  }
  if (publish?.aggregateArtifactPath !== undefined) {
    validateOptionalSafeRelativePath(publish.aggregateArtifactPath, 'publish.aggregateArtifactPath', issues);
  }
  if (publish?.aggregateUploadGlobs !== undefined) {
    validateArray(publish.aggregateUploadGlobs, 'publish.aggregateUploadGlobs', issues, { minLength: 1 });
    if (Array.isArray(publish.aggregateUploadGlobs)) {
      publish.aggregateUploadGlobs.forEach((glob, index) =>
        validateRequiredString(glob, `publish.aggregateUploadGlobs[${index}]`, issues)
      );
    }
  }
  if (publish?.retentionDays !== undefined) {
    if (!Number.isInteger(publish.retentionDays) || publish.retentionDays < 1 || publish.retentionDays > 90) {
      issues.push('publish.retentionDays must be an integer from 1 to 90');
    }
  }
}

function validateChangelog(changelog, issues) {
  validateObject(changelog, 'release.changelog', issues);
  validateKnownProperties(changelog, 'release.changelog', CHANGELOG_CONFIG_KEYS, issues);
  if (changelog?.enabled !== undefined && typeof changelog.enabled !== 'boolean') {
    issues.push('release.changelog.enabled must be a boolean');
  }
  if (changelog?.source !== undefined) {
    validateEnum(changelog.source, 'release.changelog.source', SUPPORTED_CHANGELOG_SOURCES, issues);
  }
  if (changelog?.path !== undefined) {
    validateOptionalSafeRelativePath(changelog.path, 'release.changelog.path', issues);
  }
  if (changelog?.source === 'file' && typeof changelog.path !== 'string') {
    issues.push('release.changelog.path is required when release.changelog.source is file');
  }
  if (changelog?.includeCommitSubjects !== undefined && typeof changelog.includeCommitSubjects !== 'boolean') {
    issues.push('release.changelog.includeCommitSubjects must be a boolean');
  }
  if (changelog?.maxCommitSubjects !== undefined) {
    if (!Number.isInteger(changelog.maxCommitSubjects) || changelog.maxCommitSubjects < 1 || changelog.maxCommitSubjects > 200) {
      issues.push('release.changelog.maxCommitSubjects must be an integer from 1 to 200');
    }
  }
}

function validateObject(value, label, issues) {
  if (!isPlainObject(value)) {
    issues.push(`${label} must be an object`);
  }
}

function validateKnownProperties(value, label, supportedKeys, issues) {
  if (!isPlainObject(value)) {
    return;
  }
  const supported = new Set(supportedKeys);
  for (const key of Object.keys(value)) {
    if (!supported.has(key)) {
      issues.push(`${label ? `${label}.` : ''}${key} is not supported`);
    }
  }
}

function validateArray(value, label, issues, { minLength = 0 } = {}) {
  if (!Array.isArray(value)) {
    issues.push(`${label} must be an array`);
    return;
  }
  if (value.length < minLength) {
    issues.push(`${label} must contain at least ${minLength} item${minLength === 1 ? '' : 's'}`);
  }
}

function validateRequiredString(value, label, issues, { pattern = null } = {}) {
  if (typeof value !== 'string' || value.trim() === '') {
    issues.push(`${label} must be a non-empty string`);
    return;
  }
  if (pattern && !pattern.test(value)) {
    issues.push(`${label} has invalid value: ${value}`);
  }
}

function validateOptionalString(value, label, issues, { pattern = null } = {}) {
  if (value === undefined || value === null) {
    return;
  }
  validateRequiredString(value, label, issues, { pattern });
}

function validateOptionalGitRef(value, label, issues) {
  if (value === undefined || value === null) {
    return;
  }
  validateRequiredString(value, label, issues);
  if (typeof value === 'string' && !isSafeGitRef(value)) {
    issues.push(`${label} must be a safe git ref`);
  }
}

function assertMatchesPattern(value, label, pattern, description) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} is required`);
  }
  if (!pattern.test(value)) {
    throw new Error(`${label} must match ${description}`);
  }
}

function validateEnum(value, label, supported, issues) {
  if (!supported.includes(String(value))) {
    issues.push(`${label} must be one of ${supported.join(', ')}`);
  }
}

function validateOptionalSafeRelativePath(value, label, issues) {
  if (value === undefined || value === null) {
    return;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    issues.push(`${label} must be a non-empty relative path`);
    return;
  }
  if (!isSafeRelativePath(value, { allowDot: true })) {
    issues.push(`${label} must be a safe relative path`);
  }
}

function validateOutputGlob(value, label, issues) {
  if (typeof value !== 'string' || value.trim() === '') {
    issues.push(`${label} must be a non-empty relative glob`);
    return;
  }
  if (!isSafeRelativePath(value) || value.includes('\\')) {
    issues.push(`${label} must be a safe forward-slash relative glob`);
  }
}

function isSafeRelativePath(value, { allowDot = false } = {}) {
  const text = String(value);
  const normalized = text.replaceAll('\\', '/');
  if (allowDot && normalized === '.') {
    return true;
  }
  return !path.isAbsolute(text)
    && !normalized.startsWith('/')
    && !normalized.split('/').includes('..')
    && normalized !== '.'
    && normalized.trim() !== '';
}

function pathsOverlap(first, second) {
  const left = normalizeRelativePathForOverlap(first);
  const right = normalizeRelativePathForOverlap(second);
  if (!left || !right) {
    return false;
  }
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function normalizeRelativePathForOverlap(value) {
  const normalized = String(value ?? '').trim().replaceAll('\\', '/').replace(/\/+/gu, '/').replace(/\/$/u, '');
  if (!normalized || normalized === '.') {
    return '.';
  }
  return normalized;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSafeGitRef(value) {
  const text = String(value);
  if (text.trim() === '') {
    return false;
  }
  if (text.startsWith('-')) {
    return false;
  }
  if (/[\u0000-\u001f\u007f\s]/u.test(text)) {
    return false;
  }
  if (/[\\~^:?*\[]/u.test(text)) {
    return false;
  }
  if (text.includes('..') || text.includes('@{') || text.includes('//')) {
    return false;
  }
  if (text.endsWith('/') || text.endsWith('.') || text.endsWith('.lock')) {
    return false;
  }
  return text.split('/').every((part) => part !== '' && part !== '.' && part !== '..' && !part.endsWith('.lock'));
}

function artifactEvidencePathForPackage(deployment, packageItem) {
  return (deployment?.artifactEvidencePath ?? `.sdkwork/evidence/${packageItem.packageId}.json`)
    .replaceAll('{packageId}', packageItem.packageId)
    .replaceAll('{targetId}', packageItem.id);
}

function artifactEvidencePathsForPackage(config, packageItem) {
  if (packageItem.deployable === false) return [];
  const matchingDeployments = (config.deployments ?? [])
    .filter((deployment) => deploymentMatchesPackage(deployment, packageItem));
  const paths = matchingDeployments.length > 0
    ? matchingDeployments.map((deployment) => artifactEvidencePathForPackage(deployment, packageItem))
    : [artifactEvidencePathForPackage(null, packageItem)];
  return unique(paths);
}

function withWorkflowArtifactMetadata(config, packageItem) {
  const scope = packageItem.deployable === false ? 'non-deployable' : 'publishable';
  const artifactEvidencePaths = artifactEvidencePathsForPackage(config, packageItem);
  const artifactUploadGlobs = unique([...packageItem.outputGlobs, ...artifactEvidencePaths]);
  return {
    ...packageItem,
    workflowArtifactName: `${WORKFLOW_ARTIFACT_PREFIX}-${scope}-${packageItem.artifactName}`,
    artifactEvidencePaths,
    artifactEvidencePathsText: artifactEvidencePaths.join('\n'),
    artifactUploadGlobs,
    artifactUploadGlobsText: artifactUploadGlobs.join('\n'),
  };
}

function createPackageMatrix(config, filters = {}) {
  const issues = validateWorkflowConfig(config);
  if (issues.length > 0) {
    throw new Error(`Invalid workflow config: ${issues.join('; ')}`);
  }

  const normalizedFilters = {
    deploymentProfile: filters.deploymentProfile ?? 'all',
    runtimeTarget: filters.runtimeTarget ?? 'all',
    platform: filters.platform ?? 'all',
    architecture: filters.architecture ?? 'all',
    profile: filters.profile ?? 'all',
    variant: filters.variant ?? 'all',
    format: filters.format ?? 'all',
  };

  const include = [];
  for (const target of config.targets) {
    const binding = targetProfileBinding(target);
    const supportedDeploymentProfiles = binding === 'runtime-configurable'
      ? target.supportedDeploymentProfiles
      : undefined;
    const activeDeploymentProfile = binding === 'runtime-configurable'
      ? (normalizedFilters.deploymentProfile === 'all'
        ? target.defaultDeploymentProfile
        : normalizedFilters.deploymentProfile)
      : target.deploymentProfile;
    if (binding === 'non-deployable' && normalizedFilters.deploymentProfile !== 'all') {
      continue;
    }
    if (binding === 'runtime-configurable'
      && normalizedFilters.deploymentProfile !== 'all'
      && !supportedDeploymentProfiles.includes(normalizedFilters.deploymentProfile)) {
      continue;
    }
    if (binding !== 'runtime-configurable' && !matchesFilter(activeDeploymentProfile, normalizedFilters.deploymentProfile)) {
      continue;
    }
    if (!matchesFilter(target.runtimeTarget, normalizedFilters.runtimeTarget)) {
      continue;
    }
    if (!matchesFilter(target.platform, normalizedFilters.platform)) {
      continue;
    }
    if (!matchesFilter(target.architecture, normalizedFilters.architecture)) {
      continue;
    }
    if (!matchesFilter(target.profile, normalizedFilters.profile)) {
      continue;
    }
    if (!matchesFilter(target.variant ?? '', normalizedFilters.variant)) {
      continue;
    }

    for (const format of target.formats) {
      if (!matchesFilter(format, normalizedFilters.format)) {
        continue;
      }
      const packageId = packageIdForTarget(target, format);
      const packageItem = {
        id: target.id,
        profileBinding: binding,
        ...(activeDeploymentProfile ? { deploymentProfile: activeDeploymentProfile } : {}),
        ...(supportedDeploymentProfiles ? { supportedDeploymentProfiles } : {}),
        ...(target.defaultDeploymentProfile ? { defaultDeploymentProfile: target.defaultDeploymentProfile } : {}),
        deployable: binding !== 'non-deployable',
        runtimeTarget: target.runtimeTarget,
        ...(target.targetPlatform ? { targetPlatform: target.targetPlatform } : {}),
        ...(target.clientArchitecture ? { clientArchitecture: target.clientArchitecture } : {}),
        profile: target.profile,
        platform: target.platform,
        ...(target.distribution ? { distribution: target.distribution } : {}),
        architecture: target.architecture,
        ...(target.variant ? { variant: target.variant } : {}),
        format,
        runner: target.runner,
        packageId,
        artifactName: createArtifactName(config.release.artifactPrefix, packageId),
        outputGlobs: target.outputGlobs,
        outputGlobsText: target.outputGlobs.join('\n'),
        ...(target.artifactPath ? { artifactPath: target.artifactPath } : {}),
        ...(target.environment ? { environment: target.environment } : {}),
        ...(target.signing !== undefined ? { signing: target.signing } : {}),
      };
      include.push(withWorkflowArtifactMetadata(config, packageItem));
    }
  }

  if (include.length === 0) {
    throw new Error(
      `No package targets selected for deploymentProfile=${normalizedFilters.deploymentProfile}, runtimeTarget=${normalizedFilters.runtimeTarget}, platform=${normalizedFilters.platform}, architecture=${normalizedFilters.architecture}, profile=${normalizedFilters.profile}, variant=${normalizedFilters.variant}, format=${normalizedFilters.format}`,
    );
  }

  return { include };
}

function createDeploymentMatrix(config, { packageMatrix = null, filters = {} } = {}) {
  const issues = validateWorkflowConfig(config);
  if (issues.length > 0) {
    throw new Error(`Invalid workflow config: ${issues.join('; ')}`);
  }
  const deployments = config.deployments ?? [];
  const selectedPackages = packageMatrix ?? createPackageMatrix(config, filters);
  const include = [];

  for (const deployment of deployments) {
    for (const packageItem of selectedPackages.include) {
      if (!deploymentMatchesPackage(deployment, packageItem)) {
        continue;
      }
      const activeDeploymentProfile = deployment.deploymentProfile ?? packageItem.deploymentProfile;
      const artifactEvidencePath = artifactEvidencePathForPackage(deployment, packageItem);
      include.push({
        id: deployment.id,
        environment: deployment.environment,
        ...(deployment.url ? { url: deployment.url } : {}),
        runner: deployment.runner ?? packageItem.runner,
        lifecycle: deployment.lifecycle ?? 'deploy',
        targetId: packageItem.id,
        packageId: packageItem.packageId,
        deploymentProfile: activeDeploymentProfile,
        profileBinding: packageItem.profileBinding,
        ...(packageItem.supportedDeploymentProfiles ? { supportedDeploymentProfiles: packageItem.supportedDeploymentProfiles } : {}),
        artifactEvidencePath,
        runtimeTarget: packageItem.runtimeTarget,
        profile: packageItem.profile,
        platform: packageItem.platform,
        ...(packageItem.distribution ? { distribution: packageItem.distribution } : {}),
        architecture: packageItem.architecture,
        ...(packageItem.variant ? { variant: packageItem.variant } : {}),
        format: packageItem.format,
      });
    }
  }

  return { include };
}

function deploymentMatchesPackage(deployment, packageItem) {
  if (packageItem.profileBinding === 'non-deployable') {
    return false;
  }
  const deploymentProfileMatches = packageItem.profileBinding === 'runtime-configurable'
    ? (deployment.deploymentProfile === undefined
      || packageItem.supportedDeploymentProfiles?.includes(deployment.deploymentProfile) === true)
    : matchesFilter(packageItem.deploymentProfile, deployment.deploymentProfile ?? 'all');
  return deploymentProfileMatches
    && matchesFilter(packageItem.runtimeTarget, deployment.runtimeTarget ?? 'all')
    && matchesFilter(packageItem.profile, deployment.profile ?? 'all')
    && matchesFilter(packageItem.platform, deployment.platform ?? 'all')
    && matchesFilter(packageItem.architecture, deployment.architecture ?? 'all')
    && matchesFilter(packageItem.variant ?? '', deployment.variant ?? 'all')
    && matchesFilter(packageItem.format, deployment.format ?? 'all')
    && matchesFilter(packageItem.id, deployment.targetId ?? 'all')
    && matchesFilter(packageItem.packageId, deployment.packageId ?? 'all');
}

function packageIdForTarget(target, format) {
  return target.packageId ?? canonicalPackageIdForTarget(target, format);
}

function targetProfileToken(target) {
  const binding = targetProfileBinding(target);
  if (binding === 'runtime-configurable') return 'dual';
  if (binding === 'non-deployable') return 'test';
  return target.deploymentProfile;
}

function canonicalPackageIdForTarget(target, format) {
  const profileToken = targetProfileToken(target);
  if (target.platform === 'linux' && isLinuxNativePackageFormat(format) && target.distribution) {
    return joinPackageIdSegments(target.platform, target.distribution, target.architecture, profileToken, target.profile, target.variant, formatToken(format));
  }
  return joinPackageIdSegments(target.platform, target.architecture, profileToken, target.profile, target.variant, formatToken(format));
}

function targetGroupIdForTarget(target) {
  return joinPackageIdSegments(target.platform, target.architecture, targetProfileToken(target), target.profile, target.variant);
}

function joinPackageIdSegments(...segments) {
  return segments.map((segment) => String(segment ?? '').trim()).filter(Boolean).join('-');
}

function isLinuxNativePackageFormat(format) {
  return format === 'deb' || format === 'rpm';
}

function linuxDistributionsForFormat(format) {
  if (format === 'deb') {
    return SUPPORTED_DEB_DISTRIBUTIONS;
  }
  if (format === 'rpm') {
    return SUPPORTED_RPM_DISTRIBUTIONS;
  }
  return [];
}

function formatToken(format) {
  return String(format).replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
}

function matchesFilter(value, filter) {
  return filter === undefined || filter === null || filter === 'all' || value === filter;
}

function createArtifactName(prefix, packageId) {
  return `${prefix}-${packageId}`;
}

function createDependencyPlan(config, inputRefs = {}) {
  const issues = validateWorkflowConfig(config);
  if (issues.length > 0) {
    throw new Error(`Invalid workflow config: ${issues.join('; ')}`);
  }
  const dependencies = [
    ...(config.dependencies ?? []).map((dependency, sourceIndex) => ({
      dependency,
      dependencyType: 'runtime',
      purpose: '',
      sourceIndex,
    })),
    ...(config.verificationDependencies ?? []).map((dependency, sourceIndex) => ({
      dependency,
      dependencyType: 'verification',
      purpose: dependency.purpose ?? '',
      sourceIndex,
    })),
  ];
  return {
    include: dependencies.map(({ dependency, dependencyType, purpose, sourceIndex }) => {
      const ref = resolveDependencyRef(dependency, inputRefs);
      if (!isSafeGitRef(ref)) {
        const source = dependency.refInput && inputRefs[dependency.refInput]
          ? ` resolved from ${dependency.refInput}`
          : '';
        const label = dependencyType === 'verification' ? 'verificationDependencies' : 'dependencies';
        throw new Error(`${label}[${sourceIndex}].ref${source} must be a safe git ref`);
      }
      return {
        id: dependency.id,
        repository: dependency.repository,
        ref,
        path: resolvedDependencyPath(dependency),
        tokenSecret: dependency.tokenSecret ?? null,
        submodules: dependency.submodules ?? false,
        dependencyType,
        purpose,
      };
    }),
  };
}

function createToolchainPlan(config) {
  const issues = validateWorkflowConfig(config);
  if (issues.length > 0) {
    throw new Error(`Invalid workflow config: ${issues.join('; ')}`);
  }
  const toolchains = config.toolchains ?? {};
  return {
    node: stringOrEmpty(toolchains.node),
    pnpm: stringOrEmpty(toolchains.pnpm),
    python: stringOrEmpty(toolchains.python),
    java: stringOrEmpty(toolchains.java),
    go: stringOrEmpty(toolchains.go),
    rust: stringOrEmpty(toolchains.rust),
    flutter: stringOrEmpty(toolchains.flutter),
    dotnet: stringOrEmpty(toolchains.dotnet),
    android: String(toolchains.android === true),
    xcode: String(toolchains.xcode === true),
    wix: stringOrEmpty(toolchains.wix),
  };
}

function stringOrEmpty(value) {
  return value === undefined || value === null ? '' : String(value);
}

function resolveDependencyRef(dependency, inputRefs = {}) {
  if (dependency.refInput && inputRefs[dependency.refInput]) {
    return inputRefs[dependency.refInput];
  }
  return dependency.ref ?? 'main';
}

function parseJsonObject(value, label) {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(stripJsonComments(stripUtf8Bom(value)));
    if (!isPlainObject(parsed)) {
      throw new Error(`${label} must be a JSON object`);
    }
    return parsed;
  } catch (error) {
    throw new Error(`Invalid ${label}: ${error.message}`);
  }
}

async function loadJsonObjectFile(filePath, label) {
  if (!filePath) {
    return {};
  }
  const raw = await readFile(path.resolve(filePath), 'utf8');
  return parseJsonObject(raw, label);
}

function evidenceReferencePresent(value) {
  if (typeof value === 'string') return value.trim() !== '';
  return isPlainObject(value) && Object.keys(value).length > 0;
}

function validateArtifactEvidenceDocument(evidence, matrixItem, {
  environment = null,
  expectedVersion = null,
  expectedSourceCommit = null,
} = {}) {
  const issues = [];
  if (!isPlainObject(evidence)) return ['artifact evidence must be a JSON object'];
  for (const field of ['artifactId', 'artifactPath', 'digest', 'version', 'sourceCommit', 'packageId', 'profileBinding', 'runtimeTarget']) {
    validateRequiredString(evidence[field], `artifact evidence ${field}`, issues);
  }
  if (typeof evidence.artifactPath === 'string' && !isSafeRelativePath(evidence.artifactPath)) {
    issues.push('artifact evidence artifactPath must be a safe relative path');
  }
  if (typeof evidence.digest === 'string' && !/^sha256:[a-f0-9]{64}$/u.test(evidence.digest)) {
    issues.push('artifact evidence digest must use sha256:<64 lowercase hex characters>');
  }
  if (typeof evidence.version === 'string'
    && !/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(evidence.version)) {
    issues.push('artifact evidence version must use SemVer');
  }
  if (typeof evidence.sourceCommit === 'string' && !/^[0-9a-f]{7,64}$/u.test(evidence.sourceCommit)) {
    issues.push('artifact evidence sourceCommit must be a 7-64 character lowercase Git object id');
  }
  if (expectedVersion && evidence.version !== expectedVersion) {
    issues.push('artifact evidence version does not match selected package version');
  }
  if (expectedSourceCommit && evidence.sourceCommit !== expectedSourceCommit) {
    issues.push('artifact evidence sourceCommit does not match selected source commit');
  }
  if (!['fixed', 'runtime-configurable'].includes(evidence.profileBinding)) {
    issues.push('artifact evidence profileBinding must be fixed or runtime-configurable');
  }
  if (evidence.packageId !== matrixItem.packageId) issues.push('artifact evidence packageId does not match selected package');
  if (evidence.profileBinding !== matrixItem.profileBinding) issues.push('artifact evidence profileBinding does not match selected package');
  if (evidence.runtimeTarget !== matrixItem.runtimeTarget) issues.push('artifact evidence runtimeTarget does not match selected package');
  if (evidence.profileBinding === 'fixed') {
    if (evidence.deploymentProfile !== matrixItem.deploymentProfile) {
      issues.push('artifact evidence deploymentProfile does not match selected deployment profile');
    }
    if (evidence.supportedDeploymentProfiles !== undefined) {
      issues.push('fixed artifact evidence must not declare supportedDeploymentProfiles');
    }
  }
  if (evidence.profileBinding === 'runtime-configurable') {
    if (evidence.deploymentProfile !== undefined) {
      issues.push('runtime-configurable artifact evidence must not declare deploymentProfile');
    }
    if (!Array.isArray(evidence.supportedDeploymentProfiles)
      || evidence.supportedDeploymentProfiles.length !== 2
      || !SUPPORTED_DEPLOYMENT_PROFILES.every((profile) => evidence.supportedDeploymentProfiles.includes(profile))
      || !evidence.supportedDeploymentProfiles.includes(matrixItem.deploymentProfile)) {
      issues.push('runtime-configurable artifact evidence must support standalone and cloud including the selected profile');
    }
  }
  const lifecycleEnvironment = ['test', 'staging', 'production'].includes(environment) ? environment : null;
  if (lifecycleEnvironment && evidence.environment !== undefined && evidence.environment !== lifecycleEnvironment) {
    issues.push('artifact evidence environment does not match selected deployment environment');
  }
  if (lifecycleEnvironment && evidence.profile !== undefined
    && evidence.profile !== `${matrixItem.deploymentProfile}.${lifecycleEnvironment}`) {
    issues.push('artifact evidence profile does not match selected deployment profile and environment');
  }
  for (const field of ['sbom', 'provenance', 'signature']) {
    if (!evidenceReferencePresent(evidence[field])) issues.push(`artifact evidence ${field} reference is required`);
  }
  return issues;
}

function resolveArtifactFile(artifactRoot, artifactPath) {
  if (!isSafeRelativePath(artifactRoot, { allowDot: true })) {
    throw new Error('--artifact-root must be a safe relative path');
  }
  if (!isSafeRelativePath(artifactPath)) {
    throw new Error('artifact evidence artifactPath must be a safe relative path');
  }
  return path.resolve(artifactRoot, artifactPath);
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(`sha256:${hash.digest('hex')}`));
  });
}

async function verifyArtifactEvidence(filePath, matrixItem, options = {}) {
  if (!filePath) throw new Error('--artifact-evidence is required for evidence command');
  if (!isSafeRelativePath(filePath, { allowDot: false })) {
    throw new Error('--artifact-evidence must be a safe relative path');
  }
  const absolutePath = path.resolve(filePath);
  let evidence;
  try {
    evidence = JSON.parse(await readFile(absolutePath, 'utf8'));
  } catch (error) {
    throw new Error(`artifact evidence is not valid JSON at ${absolutePath}: ${error.message}`);
  }
  const issues = validateArtifactEvidenceDocument(evidence, matrixItem, options);
  if (typeof evidence.artifactPath === 'string' && isSafeRelativePath(evidence.artifactPath)) {
    const artifactFile = resolveArtifactFile(options.artifactRoot ?? '.', evidence.artifactPath);
    if (!existsSync(artifactFile)) {
      issues.push(`artifact evidence artifactPath does not exist: ${artifactFile}`);
    } else {
      const actualDigest = await sha256File(artifactFile);
      if (actualDigest !== evidence.digest) {
        issues.push('artifact evidence digest does not match packaged artifact bytes');
      }
    }
  }
  if (issues.length > 0) throw new Error(`invalid artifact evidence: ${issues.join('; ')}`);
  return { path: absolutePath, artifactPath: resolveArtifactFile(options.artifactRoot ?? '.', evidence.artifactPath), evidence };
}

async function createArtifactEvidence({
  outputPath,
  artifactPath,
  artifactRoot = '.',
  artifactId = null,
  version,
  sourceCommit,
  matrixItem,
  environment = null,
  sbom,
  provenance,
  signature,
}) {
  if (!outputPath || !isSafeRelativePath(outputPath)) {
    throw new Error('--artifact-evidence must be a safe relative output path');
  }
  if (!artifactPath || !isSafeRelativePath(artifactPath)) {
    throw new Error('--artifact must be a safe relative path');
  }
  const artifactFile = resolveArtifactFile(artifactRoot, artifactPath);
  if (!existsSync(artifactFile)) throw new Error(`packaged artifact not found: ${artifactFile}`);
  const evidence = {
    artifactId: artifactId || `${matrixItem.packageId}:${artifactPath}`,
    artifactPath,
    digest: await sha256File(artifactFile),
    version,
    sourceCommit,
    packageId: matrixItem.packageId,
    profileBinding: matrixItem.profileBinding,
    ...(matrixItem.profileBinding === 'fixed'
      ? { deploymentProfile: matrixItem.deploymentProfile }
      : { supportedDeploymentProfiles: matrixItem.supportedDeploymentProfiles }),
    runtimeTarget: matrixItem.runtimeTarget,
    ...(['test', 'staging', 'production'].includes(environment)
      ? { environment, profile: `${matrixItem.deploymentProfile}.${environment}` }
      : {}),
    sbom,
    provenance,
    signature,
  };
  const issues = validateArtifactEvidenceDocument(evidence, matrixItem, {
    environment,
    expectedVersion: version,
    expectedSourceCommit: sourceCommit,
  });
  if (issues.length > 0) throw new Error(`cannot create artifact evidence: ${issues.join('; ')}`);
  const absoluteOutputPath = path.resolve(outputPath);
  await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return { path: absoluteOutputPath, artifactPath: artifactFile, evidence };
}

function stripUtf8Bom(value) {
  return String(value).replace(/^\uFEFF/u, '');
}

function readGitSourceCommit(root = process.cwd()) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(`cannot resolve source commit: ${stderr.trim() || `git exited with code ${code}`}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

async function resolveEvidenceSourceCommit(settings, env = process.env) {
  if (settings.sourceCommit) return settings.sourceCommit;
  try {
    return await readGitSourceCommit(process.cwd());
  } catch (error) {
    if (env.GITHUB_SHA) return env.GITHUB_SHA;
    throw error;
  }
}

function resolvePackageVersion(config, { version = null, releaseTag = null } = {}) {
  return version || normalizeReleaseVersion(releaseTag) || config.release.defaultVersion || null;
}

function createWorkflowSummary(config, matrix, { version = null, releaseTag = null } = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    app: {
      id: config.app.id,
      repository: config.app.repository,
      sourcePath: config.app.sourcePath ?? '.',
    },
    version: resolvePackageVersion(config, { version, releaseTag }),
    targets: matrix.include.length,
    publishableTargets: matrix.include.filter((item) => item.deployable !== false).length,
    deploymentProfiles: unique(matrix.include.flatMap((item) =>
      item.supportedDeploymentProfiles ?? (item.deploymentProfile ? [item.deploymentProfile] : [])
    )),
    profileBindings: unique(matrix.include.map((item) => item.profileBinding)),
    runtimeTargets: unique(matrix.include.map((item) => item.runtimeTarget)),
    profiles: unique(matrix.include.map((item) => item.profile)),
    platforms: unique(matrix.include.map((item) => item.platform)),
    architectures: unique(matrix.include.map((item) => item.architecture)),
    variants: unique(matrix.include.map((item) => item.variant).filter(Boolean)),
    formats: unique(matrix.include.map((item) => item.format)),
    publish: {
      workflowArtifact: config.publish?.workflowArtifact !== false,
      githubRelease: config.publish?.githubRelease !== false,
      aggregateRelease: config.publish?.aggregateRelease === true,
      aggregateArtifactPath: config.publish?.aggregateArtifactPath ?? 'release-assets',
      aggregateArtifactPattern: `${WORKFLOW_ARTIFACT_PREFIX}-publishable-*`,
      aggregateUploadGlobs: config.publish?.aggregateUploadGlobs ?? ['release-assets/**/*'],
      aggregateUploadGlobsText: (config.publish?.aggregateUploadGlobs ?? ['release-assets/**/*']).join('\n'),
      retentionDays: config.publish?.retentionDays ?? null,
    },
    security: {
      oidcRequired: config.security?.oidcRequired === true,
      artifactAttestations: config.security?.artifactAttestations !== false,
      sbomRequired: config.security?.sbomRequired === true,
      signingRequired: config.security?.signingRequired === true,
    },
  };
}

async function createReleaseNotes(config, {
  root = process.cwd(),
  version = null,
  releaseTag = null,
  filters = {},
} = {}) {
  const issues = validateWorkflowConfig(config);
  if (issues.length > 0) {
    throw new Error(`Invalid workflow config: ${issues.join('; ')}`);
  }

  const changelog = config.release?.changelog ?? {};
  const configuredSource = changelog.enabled === false ? 'none' : changelog.source ?? 'auto';
  const resolvedVersion = resolvePackageVersion(config, { version, releaseTag }) || '';
  const releaseLabel = releaseTag || resolvedVersion || 'release';
  const matrix = createPackageMatrix(config, filters);
  const context = {
    appName: config.app.name ?? config.app.id,
    releaseLabel,
    version: resolvedVersion,
    releaseTag,
    packageItems: matrix.include.filter((item) => item.deployable !== false),
  };

  if (configuredSource === 'none') {
    return renderGenericReleaseNotes(context, { source: 'none', includeCommits: false, commits: [] });
  }

  if (configuredSource === 'file') {
    const fileNotes = await renderFileReleaseNotes(config, context, { root, path: changelog.path });
    return fileNotes;
  }

  if (configuredSource === 'app-manifest') {
    const manifestNotes = await renderAppManifestReleaseNotes(config, context, { root });
    if (!manifestNotes) {
      throw new Error(`No matching release.notes entry found in ${config.app.configPath ?? 'sdkwork.app.config.json'} for ${resolvedVersion || releaseLabel}`);
    }
    return manifestNotes;
  }

  if (configuredSource === 'auto') {
    const manifestNotes = await renderAppManifestReleaseNotes(config, context, { root });
    if (manifestNotes) {
      return manifestNotes;
    }
    const defaultChangelogPath = path.resolve(root, 'CHANGELOG.md');
    if (existsSync(defaultChangelogPath)) {
      return renderFileReleaseNotes(config, context, { root, path: 'CHANGELOG.md' });
    }
  }

  const includeCommits = changelog.includeCommitSubjects !== false;
  const maxCommits = changelog.maxCommitSubjects ?? 50;
  const commits = includeCommits ? await readGitCommitSubjects(root, { maxCommits }) : [];
  return renderGenericReleaseNotes(context, {
    source: 'git',
    includeCommits,
    commits,
  });
}

async function renderAppManifestReleaseNotes(config, context, { root }) {
  const manifestPath = await resolveExistingAppManifestPath(config, root);
  if (!manifestPath) {
    return null;
  }
  const manifest = parseJsonObject(await readFile(manifestPath, 'utf8'), 'sdkwork app config');
  const notes = Array.isArray(manifest.release?.notes) ? manifest.release.notes : [];
  if (notes.length === 0) {
    return null;
  }
  const note = findAppManifestReleaseNote(notes, context);
  if (!note) {
    return null;
  }
  const appName = manifest.app?.displayName ?? manifest.app?.name ?? context.appName;
  const title = stringOrEmpty(note.title) || `${appName} ${context.releaseLabel}`;
  const lines = [`# ${title}`, ''];
  appendNonEmptyParagraph(lines, note.summary);
  appendNonEmptyParagraph(lines, note.content);
  if (Array.isArray(note.highlights) && note.highlights.length > 0) {
    lines.push('## Highlights', '');
    note.highlights
      .map((highlight) => String(highlight ?? '').trim())
      .filter(Boolean)
      .forEach((highlight) => lines.push(`- ${highlight}`));
    lines.push('');
  }
  appendPackageSummary(lines, context.packageItems);
  return {
    source: 'app-manifest',
    path: manifestPath,
    content: `${trimTrailingBlankLines(lines).join('\n')}\n`,
  };
}

async function renderFileReleaseNotes(config, context, { root, path: notesPath }) {
  if (!notesPath) {
    throw new Error('release.changelog.path is required for file changelog source');
  }
  if (!isSafeRelativePath(notesPath, { allowDot: false })) {
    throw new Error('release.changelog.path must be a safe relative path');
  }
  const absolutePath = path.resolve(root, notesPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Release changelog file does not exist: ${notesPath}`);
  }
  const fileContent = await readFile(absolutePath, 'utf8');
  const lines = [`# ${context.appName} ${context.releaseLabel}`, '', fileContent.trim(), ''];
  appendPackageSummary(lines, context.packageItems);
  return {
    source: 'file',
    path: absolutePath,
    content: `${trimTrailingBlankLines(lines).join('\n')}\n`,
  };
}

function renderGenericReleaseNotes(context, { source, includeCommits, commits }) {
  const lines = [`# ${context.appName} ${context.releaseLabel}`, '', 'Automated SDKWork package release.', ''];
  if (includeCommits) {
    lines.push('## Changes', '');
    if (commits.length > 0) {
      commits.forEach((commit) => lines.push(`- ${commit}`));
    } else {
      lines.push('No commit subjects were available for this release.');
    }
    lines.push('');
  }
  appendPackageSummary(lines, context.packageItems);
  return {
    source,
    path: null,
    content: `${trimTrailingBlankLines(lines).join('\n')}\n`,
  };
}

async function resolveExistingAppManifestPath(config, root) {
  const candidates = [
    config.app.configPath,
    path.join(config.app.sourcePath ?? '.', 'sdkwork.app.config.json'),
    'sdkwork.app.config.json',
  ].filter(Boolean);
  for (const candidate of unique(candidates.map((value) => String(value).replaceAll('\\', '/')))) {
    if (!isSafeRelativePath(candidate, { allowDot: false })) {
      continue;
    }
    const absolutePath = path.resolve(root, candidate);
    if (existsSync(absolutePath)) {
      return absolutePath;
    }
  }
  return null;
}

function findAppManifestReleaseNote(notes, context) {
  const version = normalizeReleaseVersion(context.version);
  const tagVersion = normalizeReleaseVersion(context.releaseTag);
  const requestedVersions = new Set([version, tagVersion].filter(Boolean));
  if (requestedVersions.size > 0) {
    return notes.find((note) => {
      const noteVersion = normalizeReleaseVersion(note?.version);
      return noteVersion && requestedVersions.has(noteVersion);
    }) ?? null;
  }
  return notes.find((note) => {
    const noteVersion = normalizeReleaseVersion(note?.version);
    return noteVersion && (noteVersion === version || noteVersion === tagVersion);
  }) ?? notes.find((note) => note?.current === true) ?? notes[0] ?? null;
}

function normalizeReleaseVersion(value) {
  return String(value ?? '').trim().replace(/^refs\/tags\//u, '').replace(/^v(?=\d)/u, '');
}

function appendNonEmptyParagraph(lines, value) {
  const text = String(value ?? '').trim();
  if (text) {
    lines.push(text, '');
  }
}

function appendPackageSummary(lines, packageItems) {
  lines.push('## Packages', '');
  packageItems.forEach((item) => {
    const platform = item.distribution ? `${item.platform}/${item.distribution}` : item.platform;
    const profile = item.supportedDeploymentProfiles?.join('+') ?? item.deploymentProfile ?? 'non-deployable';
    lines.push(`- ${item.packageId} (${profile}, ${item.runtimeTarget}, ${platform}, ${item.architecture}, ${item.profile}, ${item.format})`);
  });
  lines.push('');
}

function trimTrailingBlankLines(lines) {
  const result = [...lines];
  while (result.length > 0 && result[result.length - 1] === '') {
    result.pop();
  }
  return result;
}

function readGitCommitSubjects(root, { maxCommits }) {
  const limit = String(Math.max(1, Math.min(maxCommits, 200)));
  return new Promise((resolve) => {
    const child = spawn('git', ['log', `--max-count=${limit}`, '--pretty=format:%s'], {
      cwd: root,
      windowsHide: true,
    });
    let stdout = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.on('error', () => {
      resolve([]);
    });
    child.on('close', (exitCode) => {
      if (exitCode !== 0) {
        resolve([]);
        return;
      }
      resolve(stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean));
    });
  });
}

function createLifecyclePlan(config, {
  phase,
  matrixItem,
  version = null,
  releaseTag = null,
  root = process.cwd(),
  aggregateRelease = false,
} = {}) {
  const issues = validateWorkflowConfig(config);
  if (issues.length > 0) {
    throw new Error(`Invalid workflow config: ${issues.join('; ')}`);
  }
  if (!phase) {
    throw new Error('phase is required');
  }
  if (!matrixItem) {
    throw new Error('matrixItem is required');
  }
  const configuredSteps = config.lifecycle?.[phase] ?? [];
  if (!Array.isArray(configuredSteps)) {
    throw new Error(`lifecycle.${phase} must be an array`);
  }

  const effectiveMatrixItem = aggregateRelease
    ? {
        id: 'aggregate-release',
        packageId: 'aggregate-release',
        profile: 'library',
        platform: 'web',
        architecture: 'noarch',
        format: 'zip',
      }
    : matrixItem;
  const aggregateUploadGlobs = config.publish?.aggregateUploadGlobs ?? ['release-assets/**/*'];
  const aggregateEnv = aggregateRelease
    ? {
        SDKWORK_RELEASE_AGGREGATE: 'true',
        SDKWORK_AGGREGATE_ARTIFACT_PATH: config.publish?.aggregateArtifactPath ?? 'release-assets',
        SDKWORK_AGGREGATE_UPLOAD_GLOBS: aggregateUploadGlobs.join('\n'),
      }
    : {};
  const baseEnv = {
    SDKWORK_APP_ID: config.app.id,
    SDKWORK_APP_REPOSITORY: config.app.repository,
    SDKWORK_APP_SOURCE_PATH: config.app.sourcePath ?? '.',
    SDKWORK_WORKFLOW_CLI: WORKFLOW_CLI_PATH,
    ...(effectiveMatrixItem.deploymentProfile ? { SDKWORK_DEPLOYMENT_PROFILE: effectiveMatrixItem.deploymentProfile } : {}),
    ...(effectiveMatrixItem.supportedDeploymentProfiles
      ? { SDKWORK_SUPPORTED_DEPLOYMENT_PROFILES: effectiveMatrixItem.supportedDeploymentProfiles.join(',') }
      : {}),
    ...(effectiveMatrixItem.runtimeTarget ? { SDKWORK_RUNTIME_TARGET: effectiveMatrixItem.runtimeTarget } : {}),
    ...(effectiveMatrixItem.targetPlatform ? { SDKWORK_TARGET_PLATFORM: effectiveMatrixItem.targetPlatform } : {}),
    ...(effectiveMatrixItem.clientArchitecture
      ? { SDKWORK_CLIENT_ARCHITECTURE: effectiveMatrixItem.clientArchitecture }
      : {}),
    SDKWORK_PACKAGE_ARCHITECTURE: effectiveMatrixItem.architecture,
    SDKWORK_PACKAGE_FORMAT: effectiveMatrixItem.format,
    SDKWORK_PACKAGE_ID: effectiveMatrixItem.packageId,
    SDKWORK_PACKAGE_PLATFORM: effectiveMatrixItem.platform,
    SDKWORK_PACKAGE_PROFILE: effectiveMatrixItem.profile,
    SDKWORK_PACKAGE_TARGET_ID: effectiveMatrixItem.id,
    ...(effectiveMatrixItem.artifactPath
      ? { SDKWORK_PACKAGE_ARTIFACT_PATH: effectiveMatrixItem.artifactPath }
      : {}),
    SDKWORK_PACKAGE_VERSION: resolvePackageVersion(config, { version, releaseTag }) || '',
    SDKWORK_RELEASE_TAG: releaseTag || '',
    ...aggregateEnv,
    ...(effectiveMatrixItem.distribution ? { SDKWORK_PACKAGE_DISTRIBUTION: effectiveMatrixItem.distribution } : {}),
    ...(effectiveMatrixItem.variant ? { SDKWORK_PACKAGE_VARIANT: effectiveMatrixItem.variant } : {}),
    ...(effectiveMatrixItem.environment ? { SDKWORK_DEPLOY_ENVIRONMENT: effectiveMatrixItem.environment } : {}),
    ...(effectiveMatrixItem.url ? { SDKWORK_DEPLOY_URL: effectiveMatrixItem.url } : {}),
    ...(effectiveMatrixItem.lifecycle ? { SDKWORK_DEPLOY_LIFECYCLE: effectiveMatrixItem.lifecycle } : {}),
    ...(effectiveMatrixItem.artifactEvidencePath ? { SDKWORK_ARTIFACT_EVIDENCE_PATH: effectiveMatrixItem.artifactEvidencePath } : {}),
    ...(effectiveMatrixItem.artifactEvidencePaths
      ? { SDKWORK_ARTIFACT_EVIDENCE_PATHS: effectiveMatrixItem.artifactEvidencePaths.join('\n') }
      : {}),
  };

  return {
    phase,
    steps: configuredSteps.map((step, index) => ({
      name: step.name ?? `${phase} step ${index + 1}`,
      shell: step.shell ?? defaultShellForMatrixItem(effectiveMatrixItem),
      workingDirectory: path.resolve(root, step.workingDirectory ?? config.app.sourcePath ?? '.'),
      run: step.run ?? null,
      ...(step.uses ? { uses: step.uses } : {}),
      env: {
        ...baseEnv,
        ...(step.env ?? {}),
      },
    })),
  };
}

async function runLifecyclePlan(plan, { env = process.env } = {}) {
  if (!plan?.phase || !Array.isArray(plan.steps)) {
    throw new Error('A lifecycle plan with phase and steps is required');
  }
  const results = [];
  for (const step of plan.steps) {
    if (step.uses) {
      throw new Error(`Lifecycle step ${step.name} uses ${step.uses}; dynamic uses steps are not executable by the lifecycle runner`);
    }
    if (!step.run) {
      throw new Error(`Lifecycle step ${step.name} must declare run`);
    }
    const result = await runShellCommand(step.run, {
      shell: step.shell,
      cwd: step.workingDirectory,
      env: {
        ...env,
        ...step.env,
      },
    });
    const stepResult = {
      name: step.name,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
    results.push(stepResult);
    if (result.exitCode !== 0) {
      return {
        ok: false,
        phase: plan.phase,
        steps: results,
      };
    }
  }
  return {
    ok: true,
    phase: plan.phase,
    steps: results,
  };
}

function runShellCommand(command, { shell = defaultShellForHost(), cwd = process.cwd(), env = process.env } = {}) {
  const invocation = shellInvocation(shell, command);
  return new Promise((resolve) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on('error', (error) => {
      resolve({
        exitCode: 1,
        stdout,
        stderr: `${stderr}${error.message}\n`,
      });
    });
    child.on('close', (exitCode) => {
      resolve({
        exitCode: exitCode ?? 1,
        stdout,
        stderr,
      });
    });
  });
}

function shellInvocation(shell, command) {
  switch (shell) {
    case 'node':
      return { command: 'node', args: ['--input-type=module', '-e', command] };
    case 'bash':
      return { command: 'bash', args: ['-euo', 'pipefail', '-c', command] };
    case 'sh':
      return { command: 'sh', args: ['-eu', '-c', command] };
    case 'pwsh':
      return { command: 'pwsh', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command] };
    case 'powershell':
      return { command: 'powershell', args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command] };
    case 'cmd':
      return { command: 'cmd.exe', args: ['/d', '/s', '/c', command] };
    default:
      throw new Error(`Unsupported lifecycle shell: ${shell}`);
  }
}

function defaultShellForHost() {
  return process.platform === 'win32' ? 'pwsh' : 'bash';
}

function defaultShellForMatrixItem(matrixItem) {
  return isWindowsPlatform(matrixItem.platform) ? 'pwsh' : 'bash';
}

function isWindowsPlatform(platform) {
  return String(platform).startsWith('windows');
}

async function initApplicationWorkflow({
  root = '.',
  appId,
  appName = null,
  repository,
  profiles = ['server'],
  frameworkRef = 'v1',
  force = false,
} = {}) {
  assertMatchesPattern(appId, 'appId', ID_PATTERN, 'lowercase letters, digits, dot, underscore, or hyphen; start with a letter or digit');
  assertMatchesPattern(repository, 'repository', REPOSITORY_PATTERN, 'GitHub owner/repo');
  if (!isSafeGitRef(frameworkRef)) {
    throw new Error('frameworkRef must be a safe git ref');
  }
  const normalizedProfiles = normalizeProfiles(profiles);
  const config = createInitialWorkflowConfig({
    appId,
    appName,
    repository,
    profiles: normalizedProfiles,
  });
  const issues = validateWorkflowConfig(config);
  if (issues.length > 0) {
    throw new Error(`Generated workflow config is invalid: ${issues.join('; ')}`);
  }
  const workflowContent = await createApplicationPackageWorkflow({ frameworkRef });

  const absoluteRoot = path.resolve(root);
  const configPath = path.join(absoluteRoot, 'sdkwork.workflow.json');
  const workflowPath = path.join(absoluteRoot, '.github', 'workflows', 'package.yml');
  const files = [
    {
      path: configPath,
      content: `${JSON.stringify(config, null, 2)}\n`,
    },
    {
      path: workflowPath,
      content: workflowContent,
    },
  ];

  if (!force) {
    for (const file of files) {
      if (existsSync(file.path)) {
        throw new Error(`${file.path} already exists; pass --force to overwrite`);
      }
    }
  }
  for (const file of files) {
    await mkdir(path.dirname(file.path), { recursive: true });
    await writeFile(file.path, file.content, 'utf8');
  }
  return {
    root: absoluteRoot,
    written: files.map((file) => file.path),
  };
}

function normalizeProfiles(profiles) {
  const values = Array.isArray(profiles)
    ? profiles
    : String(profiles ?? '').split(',');
  const normalized = [...new Set(values.map((value) => String(value).trim()).filter(Boolean))];
  if (normalized.length === 0) {
    throw new Error('profiles must contain at least one profile');
  }
  for (const profile of normalized) {
    if (!SUPPORTED_PROFILES.includes(profile)) {
      throw new Error(`Unsupported init-app profile: ${profile}`);
    }
  }
  return normalized;
}

function createInitialWorkflowConfig({ appId, appName, repository, profiles }) {
  return {
    $schema: 'https://sdkwork.com/schemas/sdkwork-workflow.schema.json',
    schemaVersion: SCHEMA_VERSION,
    app: {
      id: appId,
      ...(appName ? { name: appName } : {}),
      repository,
      sourcePath: '.',
    },
    release: {
      artifactPrefix: appId,
      defaultVersion: '0.1.0',
      changelog: {
        source: 'auto',
      },
    },
    toolchains: defaultToolchainsForProfiles(profiles),
    lifecycle: {
      install: [nodePlaceholderStep('install dependencies for', 'SDKWORK_APP_ID')],
      build: [nodePlaceholderStep('build', 'SDKWORK_PACKAGE_ID')],
      package: [nodePlaceholderStep('package', 'SDKWORK_PACKAGE_ID', 'as', 'SDKWORK_PACKAGE_FORMAT')],
      sign: [nodePlaceholderStep('signing hook for', 'SDKWORK_PACKAGE_ID')],
      sbom: [nodePlaceholderStep('sbom hook for', 'SDKWORK_PACKAGE_ID')],
      validate: [nodePlaceholderStep('validate', 'SDKWORK_PACKAGE_ID')],
      deploy: [nodePlaceholderStep('deploy', 'SDKWORK_PACKAGE_ID', 'to', 'SDKWORK_DEPLOY_ENVIRONMENT')],
      publish: [nodePlaceholderStep('publish', 'SDKWORK_PACKAGE_ID', 'to', 'SDKWORK_DEPLOY_ENVIRONMENT')],
    },
    targets: profiles.flatMap((profile) => defaultTargetsForProfile(profile)),
    publish: {
      workflowArtifact: true,
      githubRelease: true,
      retentionDays: 30,
    },
    deployments: defaultDeploymentsForProfiles(profiles),
  };
}

function nodePlaceholderStep(...parts) {
  const expression = parts
    .map((part) => part.startsWith('SDKWORK_') ? `(process.env.${part} ?? '')` : JSON.stringify(part))
    .join(', ');
  return {
    shell: 'node',
    run: `console.log(${expression});`,
  };
}

function defaultToolchainsForProfiles(profiles) {
  const toolchains = {};
  if (profiles.some((profile) => ['browser', 'desktop', 'mobile', 'tablet', 'mini-program', 'server', 'container', 'worker'].includes(profile))) {
    toolchains.node = '22';
  }
  if (profiles.some((profile) => ['browser', 'desktop', 'server', 'container', 'worker'].includes(profile))) {
    toolchains.pnpm = '10.33.0';
  }
  if (profiles.includes('server')) {
    toolchains.python = '3.12';
  }
  if (profiles.some((profile) => ['mobile', 'tablet'].includes(profile))) {
    toolchains.java = '21';
    toolchains.flutter = 'stable';
    toolchains.android = true;
    toolchains.xcode = true;
  }
  if (profiles.includes('tablet')) {
    toolchains.dotnet = '9.0.x';
  }
  return toolchains;
}

function defaultTargetsForProfile(profile) {
  if (profile === 'server') {
    return [
      {
        id: 'linux-debian-x64-standalone-server-deb',
        profileBinding: 'fixed',
        deploymentProfile: 'standalone',
        runtimeTarget: 'server',
        profile: 'server',
        platform: 'linux',
        distribution: 'debian',
        architecture: 'x64',
        formats: ['deb'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/server/*.deb'],
      },
      {
        id: 'linux-rhel-x64-standalone-server-rpm',
        profileBinding: 'fixed',
        deploymentProfile: 'standalone',
        runtimeTarget: 'server',
        profile: 'server',
        platform: 'linux',
        distribution: 'rhel',
        architecture: 'x64',
        formats: ['rpm'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/server/*.rpm'],
      },
      {
        id: 'linux-x64-standalone-server-tar-gz',
        profileBinding: 'fixed',
        deploymentProfile: 'standalone',
        runtimeTarget: 'server',
        profile: 'server',
        platform: 'linux',
        architecture: 'x64',
        formats: ['tar.gz'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/server/*.tar.gz'],
      },
    ];
  }
  if (profile === 'desktop') {
    return [
      {
        id: 'windows-x64-standalone-desktop-msi',
        profileBinding: 'fixed',
        deploymentProfile: 'standalone',
        runtimeTarget: 'desktop',
        targetPlatform: 'windows',
        clientArchitecture: 'tauri',
        profile: 'desktop',
        platform: 'windows',
        architecture: 'x64',
        formats: ['msi'],
        runner: 'windows-2022',
        outputGlobs: ['dist/desktop/*.msi'],
      },
      {
        id: 'windows-x64-standalone-desktop-exe',
        profileBinding: 'fixed',
        deploymentProfile: 'standalone',
        runtimeTarget: 'desktop',
        targetPlatform: 'windows',
        clientArchitecture: 'tauri',
        profile: 'desktop',
        platform: 'windows',
        architecture: 'x64',
        formats: ['exe'],
        runner: 'windows-2022',
        outputGlobs: ['dist/desktop/*.exe'],
      },
      {
        id: 'macos-arm64-standalone-desktop-dmg',
        profileBinding: 'fixed',
        deploymentProfile: 'standalone',
        runtimeTarget: 'desktop',
        targetPlatform: 'macos',
        clientArchitecture: 'tauri',
        profile: 'desktop',
        platform: 'macos',
        architecture: 'arm64',
        formats: ['dmg'],
        runner: 'macos-14',
        outputGlobs: ['dist/desktop/*.dmg'],
      },
    ];
  }
  if (profile === 'mobile') {
    return [
      {
        id: 'android-arm64-standalone-mobile-aab',
        profileBinding: 'fixed',
        deploymentProfile: 'standalone',
        runtimeTarget: 'flutter-android',
        targetPlatform: 'android',
        clientArchitecture: 'flutter',
        profile: 'mobile',
        platform: 'android',
        architecture: 'arm64',
        formats: ['aab'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['build/app/outputs/bundle/release/*.aab'],
      },
      {
        id: 'ios-universal-standalone-mobile-ipa',
        profileBinding: 'fixed',
        deploymentProfile: 'standalone',
        runtimeTarget: 'flutter-ios',
        targetPlatform: 'ios',
        clientArchitecture: 'flutter',
        profile: 'mobile',
        platform: 'ios',
        architecture: 'universal',
        formats: ['ipa'],
        runner: 'macos-14',
        outputGlobs: ['build/ios/ipa/*.ipa'],
      },
    ];
  }
  if (profile === 'tablet') {
    return [
      {
        id: 'ipados-universal-standalone-tablet-ipa',
        profileBinding: 'fixed',
        deploymentProfile: 'standalone',
        runtimeTarget: 'tablet-ipados',
        profile: 'tablet',
        platform: 'ipados',
        architecture: 'universal',
        formats: ['ipa'],
        runner: 'macos-14',
        outputGlobs: ['build/ipados/ipa/*.ipa'],
      },
      {
        id: 'android-tablet-arm64-standalone-tablet-aab',
        profileBinding: 'fixed',
        deploymentProfile: 'standalone',
        runtimeTarget: 'tablet-android',
        profile: 'tablet',
        platform: 'android-tablet',
        architecture: 'arm64',
        formats: ['aab'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['build/app/outputs/bundle/tabletRelease/*.aab'],
      },
      {
        id: 'windows-tablet-x64-standalone-tablet-msix',
        profileBinding: 'fixed',
        deploymentProfile: 'standalone',
        runtimeTarget: 'desktop',
        profile: 'tablet',
        platform: 'windows-tablet',
        architecture: 'x64',
        formats: ['msix'],
        runner: 'windows-2022',
        outputGlobs: ['dist/tablet/*.msix'],
      },
    ];
  }
  if (profile === 'browser') {
    return [
      {
        id: 'web-universal-cloud-browser-web-url',
        profileBinding: 'fixed',
        deploymentProfile: 'cloud',
        runtimeTarget: 'browser',
        targetPlatform: 'web',
        clientArchitecture: 'pc-web',
        profile: 'browser',
        platform: 'web',
        architecture: 'universal',
        formats: ['web-url'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/web/**'],
      },
    ];
  }
  if (profile === 'container') {
    return [
      {
        id: 'container-x64-cloud-container-oci',
        profileBinding: 'fixed',
        deploymentProfile: 'cloud',
        runtimeTarget: 'container',
        profile: 'container',
        platform: 'container',
        architecture: 'x64',
        formats: ['oci'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/container/*.tar'],
      },
    ];
  }
  if (profile === 'worker') {
    return [
      {
        id: 'container-x64-cloud-worker-oci',
        profileBinding: 'fixed',
        deploymentProfile: 'cloud',
        runtimeTarget: 'container',
        profile: 'worker',
        platform: 'container',
        architecture: 'x64',
        formats: ['oci'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/worker/*.tar'],
      },
    ];
  }
  if (profile === 'mini-program') {
    return [
      {
        id: 'mp-weixin-universal-cloud-mini-program-mini-program-package',
        profileBinding: 'fixed',
        deploymentProfile: 'cloud',
        runtimeTarget: 'mini-program',
        targetPlatform: 'mp-weixin',
        clientArchitecture: 'mini-program',
        profile: 'mini-program',
        platform: 'mp-weixin',
        architecture: 'universal',
        formats: ['mini-program-package'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/mini-program/**'],
      },
    ];
  }
  if (profile === 'test') {
    return [
      {
        id: 'test-noarch-test-test-zip',
        profileBinding: 'non-deployable',
        runtimeTarget: 'test-runner',
        profile: 'test',
        platform: 'test',
        architecture: 'noarch',
        formats: ['zip'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/test/*.zip'],
      },
    ];
  }
  return [
    {
      id: 'web-universal-cloud-library-zip',
      profileBinding: 'fixed',
      deploymentProfile: 'cloud',
      runtimeTarget: 'browser',
      profile: 'library',
      platform: 'web',
      architecture: 'universal',
      formats: ['zip'],
      runner: 'ubuntu-24.04',
      outputGlobs: ['dist/library/*.zip'],
    },
  ];
}

function defaultDeploymentsForProfiles(profiles) {
  const deployments = [];
  if (profiles.includes('server')) {
    deployments.push({
      id: 'production-server',
      environment: 'production',
      deploymentProfile: 'standalone',
      runtimeTarget: 'server',
      profile: 'server',
      lifecycle: 'deploy',
    });
  }
  if (profiles.includes('browser')) {
    deployments.push({
      id: 'production-browser',
      environment: 'production-browser',
      deploymentProfile: 'cloud',
      runtimeTarget: 'browser',
      profile: 'browser',
      lifecycle: 'deploy',
    });
  }
  if (profiles.includes('mobile')) {
    deployments.push({
      id: 'production-mobile',
      environment: 'production-mobile',
      deploymentProfile: 'standalone',
      profile: 'mobile',
      lifecycle: 'publish',
    });
  }
  if (profiles.includes('tablet')) {
    deployments.push({
      id: 'production-tablet',
      environment: 'production-tablet',
      deploymentProfile: 'standalone',
      profile: 'tablet',
      lifecycle: 'publish',
    });
  }
  if (profiles.includes('desktop')) {
    deployments.push({
      id: 'production-desktop',
      environment: 'production-desktop',
      deploymentProfile: 'standalone',
      runtimeTarget: 'desktop',
      profile: 'desktop',
      lifecycle: 'publish',
    });
  }
  if (profiles.includes('container')) {
    deployments.push({
      id: 'production-container',
      environment: 'production-container',
      deploymentProfile: 'cloud',
      runtimeTarget: 'container',
      profile: 'container',
      lifecycle: 'deploy',
    });
  }
  if (profiles.includes('mini-program')) {
    deployments.push({
      id: 'production-mini-program',
      environment: 'production-mini-program',
      deploymentProfile: 'cloud',
      runtimeTarget: 'mini-program',
      profile: 'mini-program',
      lifecycle: 'publish',
    });
  }
  return deployments;
}

async function createApplicationPackageWorkflow({ frameworkRef = 'v1' } = {}) {
  const templatePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'app-package.workflow.yml');
  const template = await readFile(templatePath, 'utf8');
  return template
    .replaceAll('Sdkwork-Cloud/sdkwork-github-workflow/.github/workflows/sdkwork-package.yml@v1', `Sdkwork-Cloud/sdkwork-github-workflow/.github/workflows/sdkwork-package.yml@${frameworkRef}`)
    .replaceAll('framework_ref: v1', `framework_ref: ${frameworkRef}`);
}

function unique(values) {
  return [...new Set(values)].sort();
}

function redactSecretLikeValue(value) {
  const text = String(value ?? '');
  if (!text) {
    return text;
  }
  if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(text))) {
    return '***';
  }
  return text;
}

async function writeGithubOutputs(outputs, env = process.env) {
  if (!env.GITHUB_OUTPUT) {
    throw new Error('--github-output requires GITHUB_OUTPUT to be set');
  }
  const lines = [];
  for (const [key, value] of Object.entries(outputs)) {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    lines.push(`${key}=${serialized}`);
  }
  await appendFile(env.GITHUB_OUTPUT, `${lines.join('\n')}\n`, 'utf8');
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const settings = parseArgs(argv);
  if (settings.help) {
    printHelp();
    return 0;
  }

  if (settings.command === 'init-app') {
    const result = await initApplicationWorkflow({
      root: settings.root,
      appId: settings.appId,
      appName: settings.appName,
      repository: settings.repository,
      profiles: settings.profiles,
      frameworkRef: settings.frameworkRef,
      force: settings.force,
    });
    if (settings.json) {
      console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    } else {
      console.log(`[sdkwork-workflow] initialized ${result.root}`);
      result.written.forEach((filePath) => console.log(`[sdkwork-workflow]   ${filePath}`));
    }
    return 0;
  }

  const config = await loadWorkflowConfig(settings.configPath);
  const issues = validateWorkflowConfig(config);

  if (settings.command === 'validate') {
    const result = {
      ok: issues.length === 0,
      issues,
      configPath: path.resolve(settings.configPath),
    };
    if (settings.githubOutput) {
      await writeGithubOutputs({
        ok: String(result.ok),
        issues_json: result.issues,
      }, env);
    }
    if (settings.json) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.ok) {
      console.log(`[sdkwork-workflow] valid: ${result.configPath}`);
    } else {
      console.error('[sdkwork-workflow] validation failed:');
      result.issues.forEach((issue) => console.error(`[sdkwork-workflow]   ${issue}`));
    }
    return result.ok ? 0 : 1;
  }

  if (issues.length > 0) {
    throw new Error(`Invalid workflow config: ${issues.join('; ')}`);
  }

  if (settings.command === 'matrix') {
    const matrix = createPackageMatrix(config, settings);
    const summary = createWorkflowSummary(config, matrix, { version: settings.version, releaseTag: settings.releaseTag });
    if (settings.githubOutput) {
      await writeGithubOutputs({
        matrix: JSON.stringify(matrix),
        target_count: String(matrix.include.length),
        summary_json: summary,
      }, env);
    }
    if (settings.json) {
      console.log(JSON.stringify({ ok: true, matrix, summary }, null, 2));
    } else {
      console.log(`[sdkwork-workflow] selected targets: ${matrix.include.length}`);
      matrix.include.forEach((item) =>
        console.log(`[sdkwork-workflow]   ${item.packageId} runner=${item.runner} format=${item.format}`)
      );
    }
    return 0;
  }

  if (settings.command === 'changelog') {
    if (!isSafeRelativePath(settings.outputPath, { allowDot: false })) {
      throw new Error('--output must be a safe relative path');
    }
    const notes = await createReleaseNotes(config, {
      root: process.cwd(),
      version: settings.version,
      releaseTag: settings.releaseTag,
      filters: settings,
    });
    const absoluteOutputPath = path.resolve(settings.outputPath);
    await mkdir(path.dirname(absoluteOutputPath), { recursive: true });
    await writeFile(absoluteOutputPath, notes.content, 'utf8');
    if (settings.githubOutput) {
      await writeGithubOutputs({
        notes_path: settings.outputPath,
        notes_source: notes.source,
      }, env);
    }
    if (settings.json) {
      console.log(JSON.stringify({ ok: true, path: settings.outputPath, source: notes.source }, null, 2));
    } else {
      console.log(`[sdkwork-workflow] changelog: ${settings.outputPath} (${notes.source})`);
    }
    return 0;
  }

  if (settings.command === 'evidence:create' || settings.command === 'evidence') {
    const targetId = settings.targetId || env.SDKWORK_PACKAGE_TARGET_ID;
    if (!targetId) throw new Error(`--target-id is required for ${settings.command} command`);
    const matrix = createPackageMatrix(config, settings);
    const matrixItem = matrix.include.find((item) => item.id === targetId || item.packageId === targetId);
    if (!matrixItem || matrixItem.deployable === false) {
      throw new Error(`No deployable matrix target found for --target-id ${targetId}`);
    }
    const version = resolvePackageVersion(config, {
      version: settings.version || env.SDKWORK_PACKAGE_VERSION,
      releaseTag: settings.releaseTag || env.SDKWORK_RELEASE_TAG,
    });
    if (!version) throw new Error(`--version, --release-tag, or release.defaultVersion is required for ${settings.command}`);
    const sourceCommit = await resolveEvidenceSourceCommit(settings, env);
    const result = settings.command === 'evidence:create'
      ? await createArtifactEvidence({
          outputPath: settings.artifactEvidencePath || env.SDKWORK_ARTIFACT_EVIDENCE_PATH,
          artifactPath: settings.artifactPath || env.SDKWORK_PACKAGE_ARTIFACT_PATH || matrixItem.artifactPath,
          artifactRoot: settings.artifactRoot,
          artifactId: settings.artifactId,
          version,
          sourceCommit,
          matrixItem,
          environment: settings.deployEnvironment || env.SDKWORK_DEPLOY_ENVIRONMENT,
          sbom: settings.sbomReference || env.SDKWORK_SBOM_REFERENCE,
          provenance: settings.provenanceReference || env.SDKWORK_PROVENANCE_REFERENCE,
          signature: settings.signatureReference || env.SDKWORK_SIGNATURE_REFERENCE,
        })
      : await verifyArtifactEvidence(
        settings.artifactEvidencePath || env.SDKWORK_ARTIFACT_EVIDENCE_PATH,
        matrixItem,
        {
          environment: settings.deployEnvironment || env.SDKWORK_DEPLOY_ENVIRONMENT,
          artifactRoot: settings.artifactRoot,
          expectedVersion: version,
          expectedSourceCommit: sourceCommit,
        },
      );
    if (settings.json) {
      console.log(JSON.stringify({ ok: true, path: result.path, evidence: result.evidence }, null, 2));
    } else {
      console.log(`[sdkwork-workflow] artifact evidence ${settings.command === 'evidence:create' ? 'created' : 'valid'}: ${result.path}`);
    }
    return 0;
  }

  if (settings.command === 'deployments') {
    const packageMatrix = createPackageMatrix(config, settings);
    const deploymentMatrix = createDeploymentMatrix(config, { packageMatrix });
    if (settings.githubOutput) {
      await writeGithubOutputs({
        deployments: JSON.stringify(deploymentMatrix),
        deployment_count: String(deploymentMatrix.include.length),
      }, env);
    }
    if (settings.json) {
      console.log(JSON.stringify({ ok: true, deployments: deploymentMatrix }, null, 2));
    } else {
      console.log(`[sdkwork-workflow] deployments: ${deploymentMatrix.include.length}`);
      deploymentMatrix.include.forEach((item) =>
        console.log(`[sdkwork-workflow]   ${item.id} env=${item.environment} package=${item.packageId}`)
      );
    }
    return 0;
  }

  if (settings.command === 'dependencies') {
    const dependencyPlan = createDependencyPlan(config, {
      ...env,
      ...parseJsonObject(settings.dependencyRefsJson, 'dependency refs JSON'),
      ...await loadJsonObjectFile(settings.dependencyRefsFile, 'dependency refs file'),
    });
    if (settings.githubOutput) {
      await writeGithubOutputs({
        dependencies: JSON.stringify(dependencyPlan),
        dependency_count: String(dependencyPlan.include.length),
      }, env);
    }
    if (settings.json) {
      console.log(JSON.stringify({ ok: true, dependencies: dependencyPlan }, null, 2));
    } else {
      console.log(`[sdkwork-workflow] dependencies: ${dependencyPlan.include.length}`);
      dependencyPlan.include.forEach((dependency) =>
        console.log(`[sdkwork-workflow]   ${dependency.id} ${dependency.repository}@${redactSecretLikeValue(dependency.ref)}`)
      );
    }
    return 0;
  }

  if (settings.command === 'toolchains') {
    const toolchainPlan = createToolchainPlan(config);
    if (settings.githubOutput) {
      await writeGithubOutputs(toolchainPlan, env);
    }
    if (settings.json) {
      console.log(JSON.stringify({ ok: true, toolchains: toolchainPlan }, null, 2));
    } else {
      console.log('[sdkwork-workflow] toolchains:');
      Object.entries(toolchainPlan)
        .filter(([, value]) => value !== '' && value !== 'false')
        .forEach(([key, value]) => console.log(`[sdkwork-workflow]   ${key}=${value}`));
    }
    return 0;
  }

  if (settings.command === 'lifecycle') {
    if (!settings.phase) {
      throw new Error('--phase is required for lifecycle command');
    }
    const matrix = createPackageMatrix(config, settings);
    const matrixItem = settings.targetId
      ? matrix.include.find((item) => item.id === settings.targetId || item.packageId === settings.targetId)
      : matrix.include[0];
    if (!matrixItem) {
      throw new Error(`No matrix target found for --target-id ${settings.targetId}`);
    }
    const plan = createLifecyclePlan(config, {
      phase: settings.phase,
      matrixItem: {
        ...matrixItem,
        ...(settings.deployEnvironment ? { environment: settings.deployEnvironment } : {}),
        ...(settings.deployUrl ? { url: settings.deployUrl } : {}),
        ...(settings.deployLifecycle ? { lifecycle: settings.deployLifecycle } : {}),
      },
      version: settings.version,
      releaseTag: settings.releaseTag,
      aggregateRelease: settings.aggregateRelease,
    });
    if (settings.githubOutput) {
      await writeGithubOutputs({
        lifecycle: JSON.stringify(plan),
        step_count: String(plan.steps.length),
      }, env);
    }
    if (settings.json) {
      if (settings.run) {
        const result = await runLifecyclePlan(plan, { env });
        console.log(JSON.stringify({ ok: result.ok, lifecycle: plan, result }, null, 2));
        return result.ok ? 0 : 1;
      }
      console.log(JSON.stringify({ ok: true, lifecycle: plan }, null, 2));
    } else {
      console.log(`[sdkwork-workflow] lifecycle ${plan.phase}: ${plan.steps.length} step(s)`);
      plan.steps.forEach((step) => console.log(`[sdkwork-workflow]   ${step.name}`));
      if (settings.run) {
        const result = await runLifecyclePlan(plan, { env });
        return result.ok ? 0 : 1;
      }
    }
    return 0;
  }

  throw new Error(`Unsupported command: ${settings.command}`);
}

function sameModulePath(left, right) {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return path.resolve(left) === path.resolve(right);
  }
}

const invokedPath = process.argv[1] || null;
if (invokedPath && sameModulePath(invokedPath, WORKFLOW_CLI_PATH)) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`[sdkwork-workflow] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

export {
  SCHEMA_VERSION,
  SUPPORTED_ARCHITECTURES,
  SUPPORTED_CLIENT_ARCHITECTURES,
  SUPPORTED_DEPLOYMENT_PROFILES,
  SUPPORTED_PROFILE_BINDINGS,
  SUPPORTED_FORMATS,
  SUPPORTED_PLATFORMS,
  SUPPORTED_PROFILES,
  SUPPORTED_RUNTIME_TARGETS,
  createDependencyPlan,
  createDeploymentMatrix,
  createArtifactEvidence,
  createLifecyclePlan,
  createPackageMatrix,
  createReleaseNotes,
  createToolchainPlan,
  createWorkflowSummary,
  initApplicationWorkflow,
  loadWorkflowConfig,
  main,
  parseArgs,
  redactSecretLikeValue,
  runLifecyclePlan,
  runShellCommand,
  stripJsonComments,
  stripUtf8Bom,
  loadJsonObjectFile,
  validateWorkflowConfig,
  validateArtifactEvidenceDocument,
  verifyArtifactEvidence,
  writeGithubOutputs,
};
