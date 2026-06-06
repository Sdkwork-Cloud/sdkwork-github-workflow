#!/usr/bin/env node

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCHEMA_VERSION = '2026-06-06.sdkwork.workflow.v1';
const SUPPORTED_PROFILES = Object.freeze(['server', 'desktop', 'mobile', 'tablet', 'web', 'worker', 'library']);
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;
const PACKAGE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const SUPPORTED_PLATFORMS = Object.freeze([
  'linux',
  'windows',
  'macos',
  'ios',
  'ipados',
  'android',
  'android-tablet',
  'windows-tablet',
  'web',
  'container',
]);
const SUPPORTED_ARCHITECTURES = Object.freeze(['x64', 'arm64', 'armv7', 'universal', 'wasm32', 'noarch']);
const SUPPORTED_DEB_DISTRIBUTIONS = Object.freeze(['debian', 'ubuntu']);
const SUPPORTED_RPM_DISTRIBUTIONS = Object.freeze(['rhel', 'centos', 'fedora', 'opensuse', 'suse']);
const SUPPORTED_LINUX_DISTRIBUTIONS = Object.freeze([
  ...SUPPORTED_DEB_DISTRIBUTIONS,
  ...SUPPORTED_RPM_DISTRIBUTIONS,
]);
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
  'static',
  'jar',
  'war',
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
  'toolchains',
  'lifecycle',
  'targets',
  'security',
  'publish',
  'deployments',
]);
const APP_CONFIG_KEYS = Object.freeze(['id', 'name', 'repository', 'sourcePath', 'configPath']);
const RELEASE_CONFIG_KEYS = Object.freeze(['artifactPrefix', 'defaultVersion', 'versionInput', 'tagInput', 'channelInput']);
const DEPENDENCY_CONFIG_KEYS = Object.freeze(['id', 'repository', 'ref', 'refInput', 'path', 'tokenSecret', 'submodules']);
const TOOLCHAIN_CONFIG_KEYS = Object.freeze(['node', 'pnpm', 'python', 'java', 'go', 'rust', 'flutter', 'dotnet', 'android', 'xcode', 'wix']);
const TOOLCHAIN_STRING_KEYS = Object.freeze(['node', 'pnpm', 'python', 'java', 'go', 'rust', 'flutter', 'dotnet', 'wix']);
const TOOLCHAIN_BOOLEAN_KEYS = Object.freeze(['android', 'xcode']);
const LIFECYCLE_STEP_KEYS = Object.freeze(['name', 'run', 'shell', 'workingDirectory', 'env']);
const TARGET_CONFIG_KEYS = Object.freeze(['id', 'packageId', 'profile', 'platform', 'distribution', 'architecture', 'formats', 'runner', 'outputGlobs', 'environment', 'signing']);
const SECURITY_CONFIG_KEYS = Object.freeze(['oidcRequired', 'artifactAttestations', 'sbomRequired', 'signingRequired']);
const PUBLISH_CONFIG_KEYS = Object.freeze(['workflowArtifact', 'githubRelease', 'retentionDays']);
const DEPLOYMENT_CONFIG_KEYS = Object.freeze(['id', 'environment', 'url', 'runner', 'profile', 'platform', 'architecture', 'format', 'targetId', 'packageId', 'lifecycle']);
const FRAMEWORK_CHECKOUT_PATH = '.sdkwork/github-workflow';

function printHelp() {
  console.log(`Usage: node scripts/sdkwork-workflow.mjs <command> [options]

Commands:
  validate       Validate an sdkwork.workflow.json file.
  matrix         Render the selected GitHub Actions package matrix.
  deployments    Render deployment matrix from selected package targets.
  dependencies   Render dependency checkout metadata.
  toolchains     Render declared toolchain setup metadata.
  lifecycle      Render one lifecycle phase execution plan.
  init-app       Generate sdkwork.workflow.json and package workflow for an app.

Options:
  --config <path>        Config path (default sdkwork.workflow.json).
  --platform <value>     Platform filter, or all.
  --architecture <value> Architecture filter, or all.
  --profile <value>      Profile filter, or all.
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
    platform: 'all',
    architecture: 'all',
    profile: 'all',
    format: 'all',
    version: null,
    phase: null,
    targetId: null,
    releaseTag: null,
    deployEnvironment: null,
    deployUrl: null,
    deployLifecycle: null,
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

  if (config.dependencies !== undefined) {
    validateArray(config.dependencies, 'dependencies', issues);
    if (Array.isArray(config.dependencies)) {
      config.dependencies.forEach((dependency, index) =>
        validateDependency(dependency, index, issues, { appSourcePath: config.app?.sourcePath ?? '.' })
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
    config.targets.forEach((target, index) => validateTarget(target, index, issues, seenIds));
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
    }
  }

  return issues;
}

function validateDependency(dependency, index, issues, { appSourcePath = '.' } = {}) {
  const label = `dependencies[${index}]`;
  validateObject(dependency, label, issues);
  validateKnownProperties(dependency, label, DEPENDENCY_CONFIG_KEYS, issues);
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
    return `dependencies/${dependency.id}`;
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

function validateTarget(target, index, issues, seenIds) {
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
  validateEnum(target?.profile, `${label}.profile`, SUPPORTED_PROFILES, issues);
  validateEnum(target?.platform, `${label}.platform`, SUPPORTED_PLATFORMS, issues);
  if (target?.distribution !== undefined) {
    validateEnum(target.distribution, `${label}.distribution`, SUPPORTED_LINUX_DISTRIBUTIONS, issues);
  }
  validateEnum(target?.architecture, `${label}.architecture`, SUPPORTED_ARCHITECTURES, issues);
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
  validateTargetId(target, label, issues);
  validateTargetPackageId(target, label, issues);
  validateRequiredString(target?.runner, `${label}.runner`, issues);
  validateArray(target?.outputGlobs, `${label}.outputGlobs`, issues, { minLength: 1 });
  if (Array.isArray(target?.outputGlobs)) {
    target.outputGlobs.forEach((glob, globIndex) =>
      validateOutputGlob(glob, `${label}.outputGlobs[${globIndex}]`, issues)
    );
  }
  if (target?.environment !== undefined) {
    validateOptionalString(target.environment, `${label}.environment`, issues);
  }
  if (target?.signing !== undefined && typeof target.signing !== 'boolean') {
    issues.push(`${label}.signing must be a boolean`);
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
  if (deployment?.profile !== undefined) {
    validateEnum(deployment.profile, `${label}.profile`, SUPPORTED_PROFILES, issues);
  }
  if (deployment?.platform !== undefined) {
    validateEnum(deployment.platform, `${label}.platform`, SUPPORTED_PLATFORMS, issues);
  }
  if (deployment?.architecture !== undefined) {
    validateEnum(deployment.architecture, `${label}.architecture`, SUPPORTED_ARCHITECTURES, issues);
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
        profile: target.profile,
        platform: target.platform,
        ...(target.distribution ? { distribution: target.distribution } : {}),
        architecture: target.architecture,
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
    }
    if (Array.isArray(config.targets)) {
      config.targets.forEach((target, index) => {
        if (target?.signing === false) {
          issues.push(`targets[${index}].signing cannot be false when security.signingRequired is true`);
        }
      });
    }
  }
  if (config.security?.sbomRequired === true && !hasLifecycleSteps(config.lifecycle?.sbom)) {
    issues.push('security.sbomRequired requires lifecycle.sbom steps');
  }
}

function hasLifecycleSteps(steps) {
  return Array.isArray(steps) && steps.length > 0;
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
  if (publish?.retentionDays !== undefined) {
    if (!Number.isInteger(publish.retentionDays) || publish.retentionDays < 1 || publish.retentionDays > 90) {
      issues.push('publish.retentionDays must be an integer from 1 to 90');
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

function createPackageMatrix(config, filters = {}) {
  const issues = validateWorkflowConfig(config);
  if (issues.length > 0) {
    throw new Error(`Invalid workflow config: ${issues.join('; ')}`);
  }

  const normalizedFilters = {
    platform: filters.platform ?? 'all',
    architecture: filters.architecture ?? 'all',
    profile: filters.profile ?? 'all',
    format: filters.format ?? 'all',
  };

  const include = [];
  for (const target of config.targets) {
    if (!matchesFilter(target.platform, normalizedFilters.platform)) {
      continue;
    }
    if (!matchesFilter(target.architecture, normalizedFilters.architecture)) {
      continue;
    }
    if (!matchesFilter(target.profile, normalizedFilters.profile)) {
      continue;
    }

    for (const format of target.formats) {
      if (!matchesFilter(format, normalizedFilters.format)) {
        continue;
      }
      const packageId = packageIdForTarget(target, format);
      include.push({
        id: target.id,
        profile: target.profile,
        platform: target.platform,
        ...(target.distribution ? { distribution: target.distribution } : {}),
        architecture: target.architecture,
        format,
        runner: target.runner,
        packageId,
        artifactName: createArtifactName(config.release.artifactPrefix, packageId),
        outputGlobs: target.outputGlobs,
        outputGlobsText: target.outputGlobs.join('\n'),
        ...(target.environment ? { environment: target.environment } : {}),
        ...(target.signing !== undefined ? { signing: target.signing } : {}),
      });
    }
  }

  if (include.length === 0) {
    throw new Error(
      `No package targets selected for platform=${normalizedFilters.platform}, architecture=${normalizedFilters.architecture}, profile=${normalizedFilters.profile}, format=${normalizedFilters.format}`,
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
      include.push({
        id: deployment.id,
        environment: deployment.environment,
        ...(deployment.url ? { url: deployment.url } : {}),
        runner: deployment.runner ?? packageItem.runner,
        lifecycle: deployment.lifecycle ?? 'deploy',
        targetId: packageItem.id,
        packageId: packageItem.packageId,
        profile: packageItem.profile,
        platform: packageItem.platform,
        ...(packageItem.distribution ? { distribution: packageItem.distribution } : {}),
        architecture: packageItem.architecture,
        format: packageItem.format,
      });
    }
  }

  return { include };
}

function deploymentMatchesPackage(deployment, packageItem) {
  return matchesFilter(packageItem.profile, deployment.profile ?? 'all')
    && matchesFilter(packageItem.platform, deployment.platform ?? 'all')
    && matchesFilter(packageItem.architecture, deployment.architecture ?? 'all')
    && matchesFilter(packageItem.format, deployment.format ?? 'all')
    && matchesFilter(packageItem.id, deployment.targetId ?? 'all')
    && matchesFilter(packageItem.packageId, deployment.packageId ?? 'all');
}

function packageIdForTarget(target, format) {
  return target.packageId ?? canonicalPackageIdForTarget(target, format);
}

function canonicalPackageIdForTarget(target, format) {
  if (target.platform === 'linux' && isLinuxNativePackageFormat(format) && target.distribution) {
    return `${target.platform}-${target.distribution}-${target.architecture}-${target.profile}-${formatToken(format)}`;
  }
  return `${target.platform}-${target.architecture}-${target.profile}-${formatToken(format)}`;
}

function targetGroupIdForTarget(target) {
  return `${target.platform}-${target.architecture}-${target.profile}`;
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
  const dependencies = config.dependencies ?? [];
  return {
    include: dependencies.map((dependency, index) => {
      const ref = resolveDependencyRef(dependency, inputRefs);
      if (!isSafeGitRef(ref)) {
        const source = dependency.refInput && inputRefs[dependency.refInput]
          ? ` resolved from ${dependency.refInput}`
          : '';
        throw new Error(`dependencies[${index}].ref${source} must be a safe git ref`);
      }
      return {
        id: dependency.id,
        repository: dependency.repository,
        ref,
        path: dependency.path ?? `dependencies/${dependency.id}`,
        tokenSecret: dependency.tokenSecret ?? null,
        submodules: dependency.submodules ?? false,
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

function stripUtf8Bom(value) {
  return String(value).replace(/^\uFEFF/u, '');
}

function createWorkflowSummary(config, matrix, { version = null } = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    app: {
      id: config.app.id,
      repository: config.app.repository,
      sourcePath: config.app.sourcePath ?? '.',
    },
    version: version || config.release.defaultVersion || null,
    targets: matrix.include.length,
    profiles: unique(matrix.include.map((item) => item.profile)),
    platforms: unique(matrix.include.map((item) => item.platform)),
    architectures: unique(matrix.include.map((item) => item.architecture)),
    formats: unique(matrix.include.map((item) => item.format)),
    publish: {
      workflowArtifact: config.publish?.workflowArtifact !== false,
      githubRelease: config.publish?.githubRelease !== false,
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

function createLifecyclePlan(config, {
  phase,
  matrixItem,
  version = null,
  releaseTag = null,
  root = process.cwd(),
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

  const baseEnv = {
    SDKWORK_APP_ID: config.app.id,
    SDKWORK_APP_REPOSITORY: config.app.repository,
    SDKWORK_APP_SOURCE_PATH: config.app.sourcePath ?? '.',
    SDKWORK_PACKAGE_ARCHITECTURE: matrixItem.architecture,
    SDKWORK_PACKAGE_FORMAT: matrixItem.format,
    SDKWORK_PACKAGE_ID: matrixItem.packageId,
    SDKWORK_PACKAGE_PLATFORM: matrixItem.platform,
    SDKWORK_PACKAGE_PROFILE: matrixItem.profile,
    SDKWORK_PACKAGE_TARGET_ID: matrixItem.id,
    SDKWORK_PACKAGE_VERSION: version || config.release.defaultVersion || '',
    SDKWORK_RELEASE_TAG: releaseTag || '',
    ...(matrixItem.distribution ? { SDKWORK_PACKAGE_DISTRIBUTION: matrixItem.distribution } : {}),
    ...(matrixItem.environment ? { SDKWORK_DEPLOY_ENVIRONMENT: matrixItem.environment } : {}),
    ...(matrixItem.url ? { SDKWORK_DEPLOY_URL: matrixItem.url } : {}),
    ...(matrixItem.lifecycle ? { SDKWORK_DEPLOY_LIFECYCLE: matrixItem.lifecycle } : {}),
  };

  return {
    phase,
    steps: configuredSteps.map((step, index) => ({
      name: step.name ?? `${phase} step ${index + 1}`,
      shell: step.shell ?? defaultShellForMatrixItem(matrixItem),
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
  if (profiles.some((profile) => ['web', 'desktop', 'mobile', 'tablet', 'server'].includes(profile))) {
    toolchains.node = '22';
  }
  if (profiles.some((profile) => ['web', 'desktop', 'server'].includes(profile))) {
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
        id: 'linux-debian-x64-server-deb',
        profile: 'server',
        platform: 'linux',
        distribution: 'debian',
        architecture: 'x64',
        formats: ['deb'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/server/*.deb'],
      },
      {
        id: 'linux-rhel-x64-server-rpm',
        profile: 'server',
        platform: 'linux',
        distribution: 'rhel',
        architecture: 'x64',
        formats: ['rpm'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/server/*.rpm'],
      },
      {
        id: 'linux-x64-server-tar-gz',
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
        id: 'windows-x64-desktop-msi',
        profile: 'desktop',
        platform: 'windows',
        architecture: 'x64',
        formats: ['msi'],
        runner: 'windows-2022',
        outputGlobs: ['dist/desktop/*.msi'],
      },
      {
        id: 'windows-x64-desktop-exe',
        profile: 'desktop',
        platform: 'windows',
        architecture: 'x64',
        formats: ['exe'],
        runner: 'windows-2022',
        outputGlobs: ['dist/desktop/*.exe'],
      },
      {
        id: 'macos-arm64-desktop-dmg',
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
        id: 'android-arm64-mobile-aab',
        profile: 'mobile',
        platform: 'android',
        architecture: 'arm64',
        formats: ['aab'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['build/app/outputs/bundle/release/*.aab'],
      },
      {
        id: 'ios-universal-mobile-ipa',
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
        id: 'ipados-universal-tablet-ipa',
        profile: 'tablet',
        platform: 'ipados',
        architecture: 'universal',
        formats: ['ipa'],
        runner: 'macos-14',
        outputGlobs: ['build/ipados/ipa/*.ipa'],
      },
      {
        id: 'android-tablet-arm64-tablet-aab',
        profile: 'tablet',
        platform: 'android-tablet',
        architecture: 'arm64',
        formats: ['aab'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['build/app/outputs/bundle/tabletRelease/*.aab'],
      },
      {
        id: 'windows-tablet-x64-tablet-msix',
        profile: 'tablet',
        platform: 'windows-tablet',
        architecture: 'x64',
        formats: ['msix'],
        runner: 'windows-2022',
        outputGlobs: ['dist/tablet/*.msix'],
      },
    ];
  }
  if (profile === 'web') {
    return [
      {
        id: 'web-noarch-web-static',
        profile: 'web',
        platform: 'web',
        architecture: 'noarch',
        formats: ['static'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/web/**'],
      },
    ];
  }
  if (profile === 'worker') {
    return [
      {
        id: 'container-x64-worker-oci',
        profile: 'worker',
        platform: 'container',
        architecture: 'x64',
        formats: ['oci'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/worker/*.tar'],
      },
    ];
  }
  return [
    {
      id: 'web-noarch-library-zip',
      profile: 'library',
      platform: 'web',
      architecture: 'noarch',
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
      profile: 'server',
      lifecycle: 'deploy',
    });
  }
  if (profiles.includes('web')) {
    deployments.push({
      id: 'production-web',
      environment: 'production-web',
      profile: 'web',
      lifecycle: 'deploy',
    });
  }
  if (profiles.includes('mobile')) {
    deployments.push({
      id: 'production-mobile',
      environment: 'production-mobile',
      profile: 'mobile',
      lifecycle: 'publish',
    });
  }
  if (profiles.includes('tablet')) {
    deployments.push({
      id: 'production-tablet',
      environment: 'production-tablet',
      profile: 'tablet',
      lifecycle: 'publish',
    });
  }
  if (profiles.includes('desktop')) {
    deployments.push({
      id: 'production-desktop',
      environment: 'production-desktop',
      profile: 'desktop',
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
    const summary = createWorkflowSummary(config, matrix, { version: settings.version });
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

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
const modulePath = fileURLToPath(import.meta.url);
if (invokedPath === modulePath) {
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
  SUPPORTED_FORMATS,
  SUPPORTED_PLATFORMS,
  SUPPORTED_PROFILES,
  createDependencyPlan,
  createDeploymentMatrix,
  createLifecyclePlan,
  createPackageMatrix,
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
  writeGithubOutputs,
};
