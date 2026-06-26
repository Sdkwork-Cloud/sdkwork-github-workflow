#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  createPackageMatrix,
  initApplicationWorkflow,
  loadWorkflowConfig,
  SUPPORTED_DEPLOYMENT_PROFILES,
  SUPPORTED_RUNTIME_TARGETS,
  validateWorkflowConfig,
} from './sdkwork-workflow.mjs';
import { mkdir, rm } from 'node:fs/promises';

const REQUIRED_FILES = Object.freeze([
  'AGENTS.md',
  'CLAUDE.md',
  '.sdkwork/README.md',
  '.sdkwork/.gitignore',
  '.sdkwork/skills/README.md',
  '.sdkwork/plugins/README.md',
  '.github/workflows/sdkwork-package.yml',
  'actions/validate-config/action.yml',
  'actions/checkout-dependencies/action.yml',
  'actions/setup-toolchains/action.yml',
  'actions/run-lifecycle/action.yml',
  'actions/publish-release/action.yml',
  'schemas/sdkwork-workflow.schema.json',
  'scripts/sdkwork-workflow.mjs',
  'templates/app-package.workflow.yml',
  'sdkwork.app.config.json',
  'examples/sdkwork-clawrouter/sdkwork.workflow.json',
  'examples/mobile-flutter/sdkwork.workflow.json',
  'examples/tablet-cross-platform/sdkwork.workflow.json',
  'README.md',
]);

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

const LEGACY_DEPENDENCY_MATERIALIZATION_PATTERNS = Object.freeze([
  new RegExp(escapeRegExp(['.sdkwork', 'dependencies'].join('/')), 'u'),
  new RegExp(escapeRegExp(['.sdkwork', 'dependencies'].join('\\')), 'u'),
  new RegExp(escapeRegExp(['deps', 'local'].join(':')), 'u'),
  new RegExp(escapeRegExp(`${['prepare-local', 'dependencies'].join('-')}.mjs`), 'u'),
  new RegExp(escapeRegExp(['SDKWORK', 'DEPENDENCIES_'].join('_')), 'u'),
  new RegExp(escapeRegExp(`[${['sdkwork', 'dependencies'].join('-')}]`), 'u'),
]);

const MANIFEST_PACKAGE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*-(standalone|cloud)-[a-z0-9][a-z0-9-]*-[a-z0-9][a-z0-9-]*$/u;

function requireFile(filePath, issues) {
  if (!existsSync(path.resolve(filePath))) {
    issues.push(`missing required file: ${filePath}`);
  }
}

function extractLiteralRunBlocks(text) {
  const lines = text.split(/\r?\n/u);
  const blocks = [];

  for (let index = 0; index < lines.length; index += 1) {
    const runLine = /^(?<indent> *)run:\s*\|[+-]?\s*$/u.exec(lines[index]);
    if (!runLine?.groups) {
      continue;
    }

    const baseIndent = runLine.groups.indent.length;
    const blockLines = [lines[index]];

    for (let blockIndex = index + 1; blockIndex < lines.length; blockIndex += 1) {
      const line = lines[blockIndex];
      if (line.trim() === '') {
        blockLines.push(line);
        continue;
      }

      const indent = /^ */u.exec(line)?.[0].length ?? 0;
      if (indent <= baseIndent) {
        break;
      }
      blockLines.push(line);
    }

    blocks.push(blockLines.join('\n'));
  }

  return blocks;
}

function validateYamlText(filePath, issues) {
  const text = readFileSync(path.resolve(filePath), 'utf8');
  if (/\t/u.test(text)) {
    issues.push(`${filePath} must not contain tab indentation`);
  }
  if (/@'\s*\r?\n[\s\S]*?\r?\n\s+'@/u.test(text)) {
    issues.push(`${filePath} contains an indented PowerShell here-string terminator`);
  }
  if (text.includes('join(matrix.outputGlobs')) {
    issues.push(`${filePath} must use matrix.outputGlobsText instead of expression-time join`);
  }
  if (LEGACY_DEPENDENCY_MATERIALIZATION_PATTERNS.some((pattern) => pattern.test(text))) {
    issues.push(`${filePath} must not reference legacy SDKWork dependency materialization`);
  }
  if (filePath.endsWith('checkout-dependencies/action.yml') && text.includes('x-access-token:${{ inputs.token }}')) {
    issues.push(`${filePath} must not put tokens into clone URLs`);
  }
  if (/--dependency-refs-json\s+'\$\{\{\s*inputs\.dependency_refs_json\s*\}\}'/u.test(text)) {
    issues.push(`${filePath} must pass dependency_refs_json through an environment variable before shell execution`);
  }
  const runBlocks = extractLiteralRunBlocks(text);
  if (runBlocks.some((block) => /\$\{\{\s*inputs\./u.test(block))) {
    issues.push(`${filePath} must not embed action input expressions in shell scripts`);
  }
}

function validateAppManifestStandard(manifest, issues, filePath = 'sdkwork.app.config.json') {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    issues.push(`${filePath} must be a JSON object`);
    return;
  }

  if (Object.prototype.hasOwnProperty.call(manifest.backend ?? {}, 'tenantId')) {
    issues.push(`${filePath}: backend.tenantId must not be present; tenant context comes from access/auth tokens`);
  }
  if (Object.prototype.hasOwnProperty.call(manifest.backend ?? {}, 'tenant_id')) {
    issues.push(`${filePath}: backend.tenant_id must not be present; tenant context comes from access/auth tokens`);
  }

  const supportedProfiles = manifest.runtime?.supportedDeploymentProfiles;
  if (!Array.isArray(supportedProfiles) || supportedProfiles.length === 0) {
    issues.push(`${filePath}: runtime.supportedDeploymentProfiles must be a non-empty array`);
  } else {
    supportedProfiles.forEach((profile, index) => {
      if (!SUPPORTED_DEPLOYMENT_PROFILES.includes(profile)) {
        issues.push(`${filePath}: runtime.supportedDeploymentProfiles[${index}] must be standalone or cloud`);
      }
    });
  }

  const defaultDeploymentProfile = manifest.runtime?.defaultDeploymentProfile;
  if (!SUPPORTED_DEPLOYMENT_PROFILES.includes(defaultDeploymentProfile)) {
    issues.push(`${filePath}: runtime.defaultDeploymentProfile must be standalone or cloud`);
  } else if (Array.isArray(supportedProfiles) && !supportedProfiles.includes(defaultDeploymentProfile)) {
    issues.push(`${filePath}: runtime.defaultDeploymentProfile must be listed in runtime.supportedDeploymentProfiles`);
  }

  const packages = manifest.artifacts?.installConfig?.packages;
  if (!Array.isArray(packages) || packages.length === 0) {
    issues.push(`${filePath}: artifacts.installConfig.packages must be a non-empty array`);
    return;
  }

  const packageIds = new Set();
  packages.forEach((packageEntry, index) => {
    const label = `${filePath}: artifacts.installConfig.packages[${index}]`;
    const packageId = packageEntry?.id;
    if (typeof packageId !== 'string' || !MANIFEST_PACKAGE_ID_PATTERN.test(packageId)) {
      issues.push(`${label}.id must use a canonical package id with deployment profile segment`);
    }
    if (packageIds.has(packageId)) {
      issues.push(`${label}.id duplicates package id ${packageId}`);
    }
    packageIds.add(packageId);

    const deploymentProfile = packageEntry?.deploymentProfile;
    if (deploymentProfile === undefined) {
      issues.push(`${label}.deploymentProfile is required`);
    } else if (!SUPPORTED_DEPLOYMENT_PROFILES.includes(deploymentProfile)) {
      issues.push(`${label}.deploymentProfile must be standalone or cloud`);
    } else if (Array.isArray(supportedProfiles) && !supportedProfiles.includes(deploymentProfile)) {
      issues.push(`${label}.deploymentProfile must be listed in runtime.supportedDeploymentProfiles`);
    }

    const runtimeTarget = packageEntry?.runtimeTarget;
    if (runtimeTarget === undefined) {
      issues.push(`${label}.runtimeTarget is required`);
    } else if (!SUPPORTED_RUNTIME_TARGETS.includes(runtimeTarget)) {
      issues.push(`${label}.runtimeTarget must be a canonical runtime target`);
    }
  });

  const defaultPackageIds = [
    ['publish.defaultPackageId', manifest.publish?.defaultPackageId],
    ['artifacts.installConfig.defaultPackageId', manifest.artifacts?.installConfig?.defaultPackageId],
  ];
  defaultPackageIds.forEach(([field, packageId]) => {
    if (typeof packageId !== 'string') {
      return;
    }
    if (!MANIFEST_PACKAGE_ID_PATTERN.test(packageId)) {
      issues.push(`${filePath}: ${field} must use a canonical package id`);
    }
    if (!packageIds.has(packageId)) {
      issues.push(`${filePath}: ${field} references unknown package id ${packageId}`);
    }
  });

  if (Array.isArray(manifest.release?.notes)) {
    manifest.release.notes.forEach((note, noteIndex) => {
      if (!Array.isArray(note?.packageIds)) {
        return;
      }
      note.packageIds.forEach((packageId, packageIndex) => {
        if (!packageIds.has(packageId)) {
          issues.push(`${filePath}: release.notes[${noteIndex}].packageIds[${packageIndex}] references unknown package id ${packageId}`);
        }
      });
    });
  }
}

function validateRootAppManifest(issues) {
  const manifestPath = 'sdkwork.app.config.json';
  if (!existsSync(path.resolve(manifestPath))) {
    return;
  }
  const manifest = JSON.parse(readFileSync(path.resolve(manifestPath), 'utf8'));
  validateAppManifestStandard(manifest, issues, manifestPath);
}

async function validateExamples(issues) {
  for (const configPath of [
    'examples/sdkwork-clawrouter/sdkwork.workflow.json',
    'examples/mobile-flutter/sdkwork.workflow.json',
    'examples/tablet-cross-platform/sdkwork.workflow.json',
  ]) {
    const config = await loadWorkflowConfig(configPath);
    const configIssues = validateWorkflowConfig(config);
    issues.push(...configIssues.map((issue) => `${configPath}: ${issue}`));
    if (configIssues.length === 0) {
      try {
        createPackageMatrix(config, {
          platform: 'all',
          architecture: 'all',
          profile: 'all',
          format: 'all',
        });
      } catch (error) {
        issues.push(`${configPath}: ${error.message}`);
      }
    }
  }
}

async function validateGenerator(issues) {
  const root = path.resolve('tmp/repository-validate/init-app');
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  try {
    await initApplicationWorkflow({
      root,
      appId: 'repository-validate-app',
      repository: 'Sdkwork-Cloud/repository-validate-app',
      profiles: ['server', 'tablet'],
    });
    const config = await loadWorkflowConfig(path.join(root, 'sdkwork.workflow.json'));
    const configIssues = validateWorkflowConfig(config);
    issues.push(...configIssues.map((issue) => `generated init-app config: ${issue}`));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function main() {
  const issues = [];
  REQUIRED_FILES.forEach((filePath) => requireFile(filePath, issues));
  for (const filePath of REQUIRED_FILES.filter((item) => item.endsWith('.yml'))) {
    validateYamlText(filePath, issues);
  }
  validateRootAppManifest(issues);
  await validateExamples(issues);
  await validateGenerator(issues);

  if (issues.length > 0) {
    console.error('[repository-validate] failed:');
    issues.forEach((issue) => console.error(`[repository-validate]   ${issue}`));
    return 1;
  }
  console.log('[repository-validate] ok');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(`[repository-validate] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

export {
  REQUIRED_FILES,
  extractLiteralRunBlocks,
  main,
  validateAppManifestStandard,
  validateExamples,
  validateYamlText,
};
