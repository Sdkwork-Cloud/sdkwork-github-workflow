#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  createPackageMatrix,
  loadWorkflowConfig,
  validateWorkflowConfig,
} from './sdkwork-workflow.mjs';

const REQUIRED_FILES = Object.freeze([
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
  'README.md',
]);

function requireFile(filePath, issues) {
  if (!existsSync(path.resolve(filePath))) {
    issues.push(`missing required file: ${filePath}`);
  }
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
  if (filePath.endsWith('checkout-dependencies/action.yml') && text.includes('x-access-token:${{ inputs.token }}')) {
    issues.push(`${filePath} must not put tokens into clone URLs`);
  }
}

async function validateExamples(issues) {
  for (const configPath of [
    'examples/sdkwork-claw-router/sdkwork.workflow.json',
    'examples/mobile-flutter/sdkwork.workflow.json',
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

async function main() {
  const issues = [];
  REQUIRED_FILES.forEach((filePath) => requireFile(filePath, issues));
  for (const filePath of REQUIRED_FILES.filter((item) => item.endsWith('.yml'))) {
    validateYamlText(filePath, issues);
  }
  await validateExamples(issues);

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
  main,
  validateExamples,
  validateYamlText,
};
