#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  createPackageMatrix,
  initApplicationWorkflow,
  loadWorkflowConfig,
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
  'examples/sdkwork-claw-router/sdkwork.workflow.json',
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

async function validateExamples(issues) {
  for (const configPath of [
    'examples/sdkwork-claw-router/sdkwork.workflow.json',
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
  validateExamples,
  validateYamlText,
};
