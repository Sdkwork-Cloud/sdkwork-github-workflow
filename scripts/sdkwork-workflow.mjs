#!/usr/bin/env node

import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCHEMA_VERSION = '2026-06-06.sdkwork.workflow.v1';
const SUPPORTED_PROFILES = Object.freeze(['server', 'desktop', 'mobile', 'tablet', 'web', 'worker', 'library']);
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

function printHelp() {
  console.log(`Usage: node scripts/sdkwork-workflow.mjs <command> [options]

Commands:
  validate       Validate an sdkwork.workflow.json file.
  matrix         Render the selected GitHub Actions package matrix.
  deployments    Render deployment matrix from selected package targets.
  dependencies   Render dependency checkout metadata.
  toolchains     Render declared toolchain setup metadata.
  lifecycle      Render one lifecycle phase execution plan.

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
      case '--json':
        settings.json = true;
        break;
      case '--run':
        settings.run = true;
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
  if (config.schemaVersion !== SCHEMA_VERSION) {
    issues.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  }

  validateObject(config.app, 'app', issues);
  validateRequiredString(config.app?.id, 'app.id', issues, { pattern: /^[a-z0-9][a-z0-9._-]*$/u });
  validateRequiredString(config.app?.repository, 'app.repository', issues, {
    pattern: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
  });
  validateOptionalSafeRelativePath(config.app?.sourcePath, 'app.sourcePath', issues);

  validateObject(config.release, 'release', issues);
  validateRequiredString(config.release?.artifactPrefix, 'release.artifactPrefix', issues, {
    pattern: /^[a-z0-9][a-z0-9._-]*$/u,
  });
  if (config.release?.defaultVersion !== undefined) {
    validateRequiredString(config.release.defaultVersion, 'release.defaultVersion', issues, {
      pattern: /^[0-9A-Za-z][0-9A-Za-z._+-]*$/u,
    });
  }

  if (config.dependencies !== undefined) {
    validateArray(config.dependencies, 'dependencies', issues);
    if (Array.isArray(config.dependencies)) {
      config.dependencies.forEach((dependency, index) => validateDependency(dependency, index, issues));
    }
  }

  if (config.toolchains !== undefined) {
    validateObject(config.toolchains, 'toolchains', issues);
  }
  if (config.lifecycle !== undefined) {
    validateLifecycle(config.lifecycle, issues);
  }

  validateArray(config.targets, 'targets', issues);
  if (Array.isArray(config.targets)) {
    const seenIds = new Set();
    config.targets.forEach((target, index) => validateTarget(target, index, issues, seenIds));
  }

  if (config.security !== undefined) {
    validateSecurity(config.security, issues);
  }
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
    }
  }

  return issues;
}

function validateDependency(dependency, index, issues) {
  const label = `dependencies[${index}]`;
  validateObject(dependency, label, issues);
  validateRequiredString(dependency?.id, `${label}.id`, issues, { pattern: /^[a-z0-9][a-z0-9._-]*$/u });
  validateRequiredString(dependency?.repository, `${label}.repository`, issues, {
    pattern: /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
  });
  validateOptionalString(dependency?.ref, `${label}.ref`, issues);
  validateOptionalString(dependency?.refInput, `${label}.refInput`, issues, {
    pattern: /^[A-Za-z_][A-Za-z0-9_]*$/u,
  });
  validateOptionalSafeRelativePath(dependency?.path, `${label}.path`, issues);
  if (dependency?.tokenSecret !== undefined) {
    validateOptionalString(dependency.tokenSecret, `${label}.tokenSecret`, issues, {
      pattern: /^[A-Z_][A-Z0-9_]*$/u,
    });
  }
  if (dependency?.submodules !== undefined && !['false', 'true', 'recursive'].includes(String(dependency.submodules))) {
    issues.push(`${label}.submodules must be false, true, or recursive`);
  }
}

function validateLifecycle(lifecycle, issues) {
  validateObject(lifecycle, 'lifecycle', issues);
  for (const key of ['preflight', 'install', 'build', 'stage', 'package', 'sign', 'sbom', 'validate', 'deploy', 'publish']) {
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
  if (step?.uses !== undefined) {
    issues.push(`${label}.uses is not supported; shared actions must be implemented in the framework, lifecycle steps must use run`);
  }
  if (!step?.run) {
    issues.push(`${label} must declare run`);
  }
  if (step?.run !== undefined) {
    validateRequiredString(step.run, `${label}.run`, issues);
  }
  if (step?.shell !== undefined && !['bash', 'pwsh', 'powershell', 'sh', 'cmd', 'node'].includes(String(step.shell))) {
    issues.push(`${label}.shell uses unsupported shell ${step.shell}`);
  }
}

function validateTarget(target, index, issues, seenIds) {
  const label = `targets[${index}]`;
  validateObject(target, label, issues);
  validateRequiredString(target?.id, `${label}.id`, issues, { pattern: /^[a-z0-9][a-z0-9._-]*$/u });
  if (target?.id) {
    if (seenIds.has(target.id)) {
      issues.push(`${label}.id is duplicated: ${target.id}`);
    }
    seenIds.add(target.id);
  }
  validateEnum(target?.profile, `${label}.profile`, SUPPORTED_PROFILES, issues);
  validateEnum(target?.platform, `${label}.platform`, SUPPORTED_PLATFORMS, issues);
  validateEnum(target?.architecture, `${label}.architecture`, SUPPORTED_ARCHITECTURES, issues);
  validateArray(target?.formats, `${label}.formats`, issues, { minLength: 1 });
  if (Array.isArray(target?.formats)) {
    target.formats.forEach((format, formatIndex) =>
      validateEnum(format, `${label}.formats[${formatIndex}]`, SUPPORTED_FORMATS, issues)
    );
  }
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

function validateDeployment(deployment, index, issues, seenIds) {
  const label = `deployments[${index}]`;
  validateObject(deployment, label, issues);
  validateRequiredString(deployment?.id, `${label}.id`, issues, { pattern: /^[a-z0-9][a-z0-9._-]*$/u });
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
    validateOptionalString(deployment.packageId, `${label}.packageId`, issues, { pattern: /^[a-z0-9][a-z0-9._-]*$/u });
  }
  if (deployment?.lifecycle !== undefined && !['deploy', 'publish'].includes(String(deployment.lifecycle))) {
    issues.push(`${label}.lifecycle must be deploy or publish`);
  }
}

function validateSecurity(security, issues) {
  validateObject(security, 'security', issues);
  for (const key of ['oidcRequired', 'artifactAttestations', 'sbomRequired', 'signingRequired']) {
    if (security?.[key] !== undefined && typeof security[key] !== 'boolean') {
      issues.push(`security.${key} must be a boolean`);
    }
  }
}

function validatePublish(publish, issues) {
  validateObject(publish, 'publish', issues);
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

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
      const packageId = target.packageId ?? `${target.platform}-${target.architecture}-${target.profile}-${format}`;
      include.push({
        id: target.id,
        profile: target.profile,
        platform: target.platform,
        architecture: target.architecture,
        format,
        runner: target.runner,
        packageId,
        artifactName: createArtifactName(config.release.artifactPrefix, target, format),
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

function matchesFilter(value, filter) {
  return filter === undefined || filter === null || filter === 'all' || value === filter;
}

function createArtifactName(prefix, target, format) {
  const formatSlug = String(format).replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
  const baseSlug = target.packageId ?? target.id;
  const targetSlug = target.formats.length > 1 ? `${baseSlug}-${formatSlug}` : baseSlug;
  return `${prefix}-${targetSlug}`;
}

function createDependencyPlan(config, inputRefs = {}) {
  const issues = validateWorkflowConfig(config);
  if (issues.length > 0) {
    throw new Error(`Invalid workflow config: ${issues.join('; ')}`);
  }
  const dependencies = config.dependencies ?? [];
  return {
    include: dependencies.map((dependency) => ({
      id: dependency.id,
      repository: dependency.repository,
      ref: resolveDependencyRef(dependency, inputRefs),
      path: dependency.path ?? `dependencies/${dependency.id}`,
      tokenSecret: dependency.tokenSecret ?? null,
      submodules: dependency.submodules ?? false,
    })),
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
  return matrixItem.platform === 'windows' ? 'pwsh' : 'bash';
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
