import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  createPackageMatrix,
  createLifecyclePlan,
  loadWorkflowConfig,
  redactSecretLikeValue,
  runLifecyclePlan,
  createDependencyPlan,
  createToolchainPlan,
  createDeploymentMatrix,
  initApplicationWorkflow,
  main,
  validateWorkflowConfig,
} from '../scripts/sdkwork-workflow.mjs';

const tempRoot = path.resolve('tmp/tests/sdkwork-workflow');

test.after(async () => {
  await rm(tempRoot, { recursive: true, force: true });
});

test('validates the minimal cross-platform workflow config', async () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: {
      id: 'demo-router',
      name: 'Demo Router',
      repository: 'Sdkwork-Cloud/demo-router',
      sourcePath: '.',
    },
    release: {
      artifactPrefix: 'demorouter',
      defaultVersion: '0.1.0',
    },
    dependencies: [
      {
        id: 'sdkwork-appbase',
        repository: 'Sdkwork-Cloud/sdkwork-appbase',
        refInput: 'sdkwork_appbase_ref',
        path: 'apps/sdkwork-appbase',
      },
    ],
    toolchains: {
      node: '22',
      pnpm: '10.33.0',
      python: '3.12',
      rust: 'stable',
    },
    lifecycle: {
      install: [{ run: 'pnpm install --frozen-lockfile' }],
      build: [{ run: 'pnpm build' }],
      package: [{ run: 'pnpm package -- --package-id ${SDKWORK_PACKAGE_ID}' }],
      validate: [{ run: 'pnpm package:validate -- --package-id ${SDKWORK_PACKAGE_ID}' }],
    },
    targets: [
      {
        id: 'server-linux-x64-deb',
        profile: 'server',
        platform: 'linux',
        architecture: 'x64',
        formats: ['deb'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/install-packages/*.deb', 'dist/install-packages/*.manifest.json'],
      },
      {
        id: 'desktop-windows-x64-msi',
        profile: 'desktop',
        platform: 'windows',
        architecture: 'x64',
        formats: ['msi'],
        runner: 'windows-2022',
        outputGlobs: ['dist/install-packages/*.msi', 'dist/install-packages/*.manifest.json'],
      },
      {
        id: 'mobile-android-arm64-aab',
        profile: 'mobile',
        platform: 'android',
        architecture: 'arm64',
        formats: ['aab'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['build/app/outputs/bundle/release/*.aab'],
      },
    ],
  };

  assert.deepEqual(validateWorkflowConfig(config), []);
});

test('rejects unsupported platforms, empty target formats, and unsafe output globs', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'bad-app', repository: 'Org/bad-app' },
    release: { artifactPrefix: 'bad-app' },
    targets: [
      {
        id: 'bad',
        profile: 'server',
        platform: 'solaris',
        architecture: 'x64',
        formats: [],
        runner: 'ubuntu-24.04',
        outputGlobs: ['../secret.env'],
      },
    ],
  };

  const issues = validateWorkflowConfig(config);
  assert.ok(issues.some((issue) => issue.includes('targets[0].platform')));
  assert.ok(issues.some((issue) => issue.includes('targets[0].formats')));
  assert.ok(issues.some((issue) => issue.includes('targets[0].outputGlobs[0]')));
});

test('rejects dynamic uses steps in lifecycle config', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'bad-uses', repository: 'Org/bad-uses' },
    release: { artifactPrefix: 'bad-uses' },
    lifecycle: {
      build: [{ uses: 'actions/setup-node@v4' }],
    },
    targets: [
      {
        id: 'linux-x64-server-tgz',
        profile: 'server',
        platform: 'linux',
        architecture: 'x64',
        formats: ['tar.gz'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/*.tar.gz'],
      },
    ],
  };

  const issues = validateWorkflowConfig(config);
  assert.ok(issues.some((issue) => issue.includes('lifecycle.build[0].uses is not supported')));
});

test('enforces required signing and SBOM security lifecycle policies', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'secure-app', repository: 'Org/secure-app' },
    release: { artifactPrefix: 'secure-app' },
    lifecycle: {
      package: [{ run: 'echo package' }],
    },
    targets: [
      {
        id: 'linux-x64-server-tgz',
        profile: 'server',
        platform: 'linux',
        architecture: 'x64',
        formats: ['tar.gz'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/*.tar.gz'],
      },
      {
        id: 'windows-x64-desktop-msi',
        profile: 'desktop',
        platform: 'windows',
        architecture: 'x64',
        formats: ['msi'],
        runner: 'windows-2022',
        outputGlobs: ['dist/*.msi'],
        signing: false,
      },
    ],
    security: {
      signingRequired: true,
      sbomRequired: true,
    },
  };

  const issues = validateWorkflowConfig(config);
  assert.ok(issues.some((issue) => issue.includes('security.signingRequired requires lifecycle.sign')));
  assert.ok(issues.some((issue) => issue.includes('security.sbomRequired requires lifecycle.sbom')));
  assert.ok(issues.some((issue) => issue.includes('targets[1].signing cannot be false')));
});

test('creates a GitHub Actions matrix filtered by platform, architecture, profile, and format', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'demo', repository: 'Org/demo' },
    release: { artifactPrefix: 'demo' },
    targets: [
      {
        id: 'linux-x64-server-tgz',
        profile: 'server',
        platform: 'linux',
        architecture: 'x64',
        formats: ['tar.gz'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/*.tar.gz'],
      },
      {
        id: 'windows-x64-desktop-msi',
        profile: 'desktop',
        platform: 'windows',
        architecture: 'x64',
        formats: ['msi'],
        runner: 'windows-2022',
        outputGlobs: ['dist/*.msi'],
      },
      {
        id: 'android-arm64-mobile-apk',
        profile: 'mobile',
        platform: 'android',
        architecture: 'arm64',
        formats: ['apk'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/*.apk'],
      },
    ],
  };

  const matrix = createPackageMatrix(config, {
    platform: 'windows',
    architecture: 'x64',
    profile: 'desktop',
    format: 'msi',
  });

  assert.deepEqual(matrix, {
    include: [
      {
        id: 'windows-x64-desktop-msi',
        profile: 'desktop',
        platform: 'windows',
        architecture: 'x64',
        format: 'msi',
        runner: 'windows-2022',
        packageId: 'windows-x64-desktop-msi',
        artifactName: 'demo-windows-x64-desktop-msi',
        outputGlobs: ['dist/*.msi'],
        outputGlobsText: 'dist/*.msi',
      },
    ],
  });
});

test('uses package id and format for multi-format artifact names', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'demo', repository: 'Org/demo' },
    release: { artifactPrefix: 'demo' },
    targets: [
      {
        id: 'linux-x64-desktop-deb',
        packageId: 'linux-x64-desktop',
        profile: 'desktop',
        platform: 'linux',
        architecture: 'x64',
        formats: ['deb', 'tar.gz'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/*'],
      },
    ],
  };

  const matrix = createPackageMatrix(config, { format: 'tar.gz' });
  assert.equal(matrix.include[0].artifactName, 'demo-linux-x64-desktop-tar-gz');
});

test('supports tablet package targets as first-class profile and platforms', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'tablet-demo', repository: 'Org/tablet-demo' },
    release: { artifactPrefix: 'tablet-demo' },
    targets: [
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
        id: 'android-tablet-arm64-aab',
        profile: 'tablet',
        platform: 'android-tablet',
        architecture: 'arm64',
        formats: ['aab'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['build/app/outputs/bundle/tabletRelease/*.aab'],
      },
      {
        id: 'windows-tablet-x64-msix',
        profile: 'tablet',
        platform: 'windows-tablet',
        architecture: 'x64',
        formats: ['msix'],
        runner: 'windows-2022',
        outputGlobs: ['dist/tablet/*.msix'],
      },
    ],
    deployments: [
      {
        id: 'tablet-store',
        environment: 'production-tablet',
        profile: 'tablet',
        lifecycle: 'publish',
      },
    ],
  };

  assert.deepEqual(validateWorkflowConfig(config), []);
  const matrix = createPackageMatrix(config, { profile: 'tablet', platform: 'android-tablet', format: 'aab' });
  assert.deepEqual(matrix.include.map((item) => item.packageId), ['android-tablet-arm64-tablet-aab']);
  const deploymentMatrix = createDeploymentMatrix(config, { packageMatrix: matrix });
  assert.equal(deploymentMatrix.include[0].environment, 'production-tablet');
});

test('loads JSON config with comments stripped and rejects invalid JSON', async () => {
  await rm(tempRoot, { recursive: true, force: true });
  await mkdir(tempRoot, { recursive: true });
  const configPath = path.join(tempRoot, 'sdkwork.workflow.json');
  await writeFile(configPath, `{
    // application identity
    "schemaVersion": "2026-06-06.sdkwork.workflow.v1",
    "app": { "id": "commented", "repository": "Org/commented" },
    "release": { "artifactPrefix": "commented" },
    "targets": []
  }`);

  const config = await loadWorkflowConfig(configPath);
  assert.equal(config.app.id, 'commented');
});

test('redacts token-like values before writing logs', () => {
  assert.equal(redactSecretLikeValue('ghp_1234567890abcdef'), '***');
  assert.equal(redactSecretLikeValue('plain-ref-name'), 'plain-ref-name');
});

test('creates dependency plan from generic ref mapping', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'demo', repository: 'Org/demo' },
    release: { artifactPrefix: 'demo' },
    dependencies: [
      {
        id: 'sdkwork-core',
        repository: 'Sdkwork-Cloud/sdkwork-core',
        refInput: 'SDKWORK_CORE_REF',
        path: 'apps/sdkwork-core',
        submodules: 'recursive',
      },
    ],
    targets: [
      {
        id: 'linux-x64-server-tgz',
        profile: 'server',
        platform: 'linux',
        architecture: 'x64',
        formats: ['tar.gz'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/*.tar.gz'],
      },
    ],
  };

  assert.deepEqual(createDependencyPlan(config, { SDKWORK_CORE_REF: 'abc123' }), {
    include: [
      {
        id: 'sdkwork-core',
        repository: 'Sdkwork-Cloud/sdkwork-core',
        ref: 'abc123',
        path: 'apps/sdkwork-core',
        tokenSecret: null,
        submodules: 'recursive',
      },
    ],
  });
});

test('loads dependency refs from a JSON file in CLI mode', async () => {
  const root = path.join(tempRoot, 'dependency-refs-file');
  await mkdir(root, { recursive: true });
  const configPath = path.join(root, 'sdkwork.workflow.json');
  const refsPath = path.join(root, 'refs.json');
  await writeFile(configPath, JSON.stringify({
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'demo', repository: 'Org/demo' },
    release: { artifactPrefix: 'demo' },
    dependencies: [
      {
        id: 'sdkwork-core',
        repository: 'Sdkwork-Cloud/sdkwork-core',
        refInput: 'SDKWORK_CORE_REF',
      },
    ],
    targets: [
      {
        id: 'linux-x64-server-tgz',
        profile: 'server',
        platform: 'linux',
        architecture: 'x64',
        formats: ['tar.gz'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/*.tar.gz'],
      },
    ],
  }));
  await writeFile(refsPath, JSON.stringify({ SDKWORK_CORE_REF: 'file-ref' }));

  const { main } = await import('../scripts/sdkwork-workflow.mjs');
  const previousWrite = process.stdout.write;
  let output = '';
  process.stdout.write = (chunk) => {
    output += String(chunk);
    return true;
  };
  try {
    assert.equal(await main([
      'dependencies',
      '--config',
      configPath,
      '--dependency-refs-file',
      refsPath,
      '--json',
    ]), 0);
  } finally {
    process.stdout.write = previousWrite;
  }

  const result = JSON.parse(output);
  assert.equal(result.dependencies.include[0].ref, 'file-ref');
});

test('loads dependency refs file with UTF-8 BOM', async () => {
  const root = path.join(tempRoot, 'dependency-refs-bom');
  await mkdir(root, { recursive: true });
  const refsPath = path.join(root, 'refs.json');
  await writeFile(refsPath, `\uFEFF${JSON.stringify({ SDKWORK_CORE_REF: 'bom-ref' })}`, 'utf8');

  const { loadJsonObjectFile } = await import('../scripts/sdkwork-workflow.mjs');
  assert.deepEqual(await loadJsonObjectFile(refsPath, 'dependency refs file'), {
    SDKWORK_CORE_REF: 'bom-ref',
  });
});

test('initializes an application workflow without overwriting existing files', async () => {
  const root = path.join(tempRoot, 'init-app');
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  const result = await initApplicationWorkflow({
    root,
    appId: 'demo-app',
    appName: 'Demo App',
    repository: 'Sdkwork-Cloud/demo-app',
    profiles: ['server', 'desktop', 'tablet'],
    frameworkRef: 'v1',
  });

  assert.equal(result.written.length, 2);
  const config = await loadWorkflowConfig(path.join(root, 'sdkwork.workflow.json'));
  assert.deepEqual(validateWorkflowConfig(config), []);
  assert.equal(config.app.id, 'demo-app');
  assert.ok(config.targets.some((target) => target.profile === 'tablet'));
  const workflow = await import('node:fs/promises').then((fs) =>
    fs.readFile(path.join(root, '.github/workflows/package.yml'), 'utf8')
  );
  assert.ok(workflow.includes('Sdkwork-Cloud/sdkwork-github-workflow/.github/workflows/sdkwork-package.yml@v1'));

  await assert.rejects(
    () => initApplicationWorkflow({
      root,
      appId: 'demo-app',
      repository: 'Sdkwork-Cloud/demo-app',
      profiles: ['server'],
    }),
    /already exists/,
  );
});

test('CLI init-app does not require an existing workflow config', async () => {
  const root = path.join(tempRoot, 'init-app-cli');
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  const previousWrite = process.stdout.write;
  let output = '';
  process.stdout.write = (chunk) => {
    output += chunk;
    return true;
  };

  try {
    assert.equal(await main([
      'init-app',
      '--root',
      root,
      '--app-id',
      'cli-demo',
      '--app-name',
      'CLI Demo',
      '--repository',
      'Sdkwork-Cloud/cli-demo',
      '--profiles',
      'server,tablet',
      '--json',
    ]), 0);
  } finally {
    process.stdout.write = previousWrite;
  }

  const result = JSON.parse(output);
  assert.equal(result.ok, true);
  const config = await loadWorkflowConfig(path.join(root, 'sdkwork.workflow.json'));
  assert.deepEqual(validateWorkflowConfig(config), []);
  assert.ok(config.targets.some((target) => target.profile === 'tablet'));
});

test('init-app rejects invalid application identity before writing files', async () => {
  const root = path.join(tempRoot, 'init-app-invalid');
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  await assert.rejects(
    () => initApplicationWorkflow({
      root,
      appId: 'Invalid App',
      repository: 'Sdkwork-Cloud/demo-app',
    }),
    /appId must match/,
  );
  await assert.rejects(
    () => initApplicationWorkflow({
      root,
      appId: 'demo-app',
      repository: 'not-a-github-repository',
    }),
    /repository must match/,
  );
});

test('creates normalized toolchain plan with empty defaults', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'demo', repository: 'Org/demo' },
    release: { artifactPrefix: 'demo' },
    toolchains: {
      node: '22',
      pnpm: '10.33.0',
      python: '3.12',
      rust: 'stable',
      wix: '5.0.2',
    },
    targets: [
      {
        id: 'linux-x64-server-tgz',
        profile: 'server',
        platform: 'linux',
        architecture: 'x64',
        formats: ['tar.gz'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/*.tar.gz'],
      },
    ],
  };

  assert.deepEqual(createToolchainPlan(config), {
    node: '22',
    pnpm: '10.33.0',
    python: '3.12',
    java: '',
    go: '',
    rust: 'stable',
    flutter: '',
    dotnet: '',
    android: 'false',
    xcode: 'false',
    wix: '5.0.2',
  });
});

test('creates deployment matrix from declared environments and selected package targets', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'demo', repository: 'Org/demo' },
    release: { artifactPrefix: 'demo' },
    targets: [
      {
        id: 'linux-x64-server-tgz',
        packageId: 'linux-x64-server',
        profile: 'server',
        platform: 'linux',
        architecture: 'x64',
        formats: ['tar.gz'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/*.tar.gz'],
      },
      {
        id: 'windows-x64-desktop-msi',
        packageId: 'windows-x64-desktop',
        profile: 'desktop',
        platform: 'windows',
        architecture: 'x64',
        formats: ['msi'],
        runner: 'windows-2022',
        outputGlobs: ['dist/*.msi'],
      },
    ],
    deployments: [
      {
        id: 'prod-server',
        environment: 'production',
        profile: 'server',
        platform: 'linux',
        runner: 'ubuntu-24.04',
        url: 'https://demo.sdkwork.com',
        lifecycle: 'deploy',
      },
      {
        id: 'prod-desktop-store',
        environment: 'production-desktop',
        profile: 'desktop',
        platform: 'windows',
        format: 'msi',
        runner: 'windows-2022',
        lifecycle: 'publish',
      },
    ],
  };

  const packageMatrix = createPackageMatrix(config, { platform: 'linux', profile: 'server', format: 'tar.gz' });
  const deploymentMatrix = createDeploymentMatrix(config, { packageMatrix });

  assert.deepEqual(deploymentMatrix, {
    include: [
      {
        id: 'prod-server',
        environment: 'production',
        url: 'https://demo.sdkwork.com',
        runner: 'ubuntu-24.04',
        lifecycle: 'deploy',
        targetId: 'linux-x64-server-tgz',
        packageId: 'linux-x64-server',
        profile: 'server',
        platform: 'linux',
        architecture: 'x64',
        format: 'tar.gz',
      },
    ],
  });
});

test('validates deployment environment and lifecycle values', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'bad-deploy', repository: 'Org/bad-deploy' },
    release: { artifactPrefix: 'bad-deploy' },
    targets: [
      {
        id: 'linux-x64-server-tgz',
        profile: 'server',
        platform: 'linux',
        architecture: 'x64',
        formats: ['tar.gz'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/*.tar.gz'],
      },
    ],
    deployments: [
      {
        id: 'bad',
        environment: '../prod',
        lifecycle: 'ship',
      },
    ],
  };

  const issues = validateWorkflowConfig(config);
  assert.ok(issues.some((issue) => issue.includes('deployments[0].environment')));
  assert.ok(issues.some((issue) => issue.includes('deployments[0].lifecycle')));
});

test('creates lifecycle command plan with target environment', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'demo', repository: 'Org/demo', sourcePath: 'apps/demo' },
    release: { artifactPrefix: 'demo', defaultVersion: '1.2.3' },
    lifecycle: {
      build: [
        {
          name: 'Build target',
          shell: 'pwsh',
          workingDirectory: 'apps/demo',
          run: 'node scripts/build.mjs --format $env:SDKWORK_PACKAGE_FORMAT',
        },
      ],
    },
    targets: [
      {
        id: 'linux-x64-server-tgz',
        packageId: 'linux-x64-server',
        profile: 'server',
        platform: 'linux',
        architecture: 'x64',
        formats: ['tar.gz'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/*.tar.gz'],
      },
    ],
  };

  const matrix = createPackageMatrix(config, { platform: 'linux', architecture: 'x64', profile: 'server', format: 'tar.gz' });
  const plan = createLifecyclePlan(config, {
    phase: 'build',
    matrixItem: matrix.include[0],
    version: '9.9.9',
    releaseTag: 'v9.9.9',
  });

  assert.deepEqual(plan, {
    phase: 'build',
    steps: [
      {
        name: 'Build target',
        shell: 'pwsh',
        workingDirectory: path.resolve('apps/demo'),
        run: 'node scripts/build.mjs --format $env:SDKWORK_PACKAGE_FORMAT',
        env: {
          SDKWORK_APP_ID: 'demo',
          SDKWORK_APP_REPOSITORY: 'Org/demo',
          SDKWORK_APP_SOURCE_PATH: 'apps/demo',
          SDKWORK_PACKAGE_ARCHITECTURE: 'x64',
          SDKWORK_PACKAGE_FORMAT: 'tar.gz',
          SDKWORK_PACKAGE_ID: 'linux-x64-server',
          SDKWORK_PACKAGE_PLATFORM: 'linux',
          SDKWORK_PACKAGE_PROFILE: 'server',
          SDKWORK_PACKAGE_TARGET_ID: 'linux-x64-server-tgz',
          SDKWORK_PACKAGE_VERSION: '9.9.9',
          SDKWORK_RELEASE_TAG: 'v9.9.9',
        },
      },
    ],
  });
});

test('creates lifecycle command plan with deployment environment values', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'demo', repository: 'Org/demo', sourcePath: 'apps/demo' },
    release: { artifactPrefix: 'demo', defaultVersion: '1.2.3' },
    lifecycle: {
      deploy: [{ run: 'echo deploy' }],
    },
    targets: [
      {
        id: 'linux-x64-server-tgz',
        packageId: 'linux-x64-server',
        profile: 'server',
        platform: 'linux',
        architecture: 'x64',
        formats: ['tar.gz'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/*.tar.gz'],
      },
    ],
  };

  const plan = createLifecyclePlan(config, {
    phase: 'deploy',
    matrixItem: {
      id: 'linux-x64-server-tgz',
      packageId: 'linux-x64-server',
      profile: 'server',
      platform: 'linux',
      architecture: 'x64',
      format: 'tar.gz',
      environment: 'production',
      url: 'https://demo.sdkwork.com',
      lifecycle: 'deploy',
    },
    version: '1.2.3',
  });

  assert.equal(plan.steps[0].env.SDKWORK_DEPLOY_ENVIRONMENT, 'production');
  assert.equal(plan.steps[0].env.SDKWORK_DEPLOY_URL, 'https://demo.sdkwork.com');
  assert.equal(plan.steps[0].env.SDKWORK_DEPLOY_LIFECYCLE, 'deploy');
});

test('uses PowerShell by default for Windows tablet lifecycle targets', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'tablet-demo', repository: 'Org/tablet-demo' },
    release: { artifactPrefix: 'tablet-demo' },
    lifecycle: {
      package: [{ run: 'Write-Output $env:SDKWORK_PACKAGE_ID' }],
    },
    targets: [
      {
        id: 'windows-tablet-x64-msix',
        profile: 'tablet',
        platform: 'windows-tablet',
        architecture: 'x64',
        formats: ['msix'],
        runner: 'windows-2022',
        outputGlobs: ['dist/tablet/*.msix'],
      },
    ],
  };

  const matrix = createPackageMatrix(config, { platform: 'windows-tablet', format: 'msix' });
  const plan = createLifecyclePlan(config, { phase: 'package', matrixItem: matrix.include[0] });

  assert.equal(plan.steps[0].shell, 'pwsh');
});

test('validates checked-in example configurations', async () => {
  const clawRouter = await loadWorkflowConfig('examples/sdkwork-claw-router/sdkwork.workflow.json');
  const mobile = await loadWorkflowConfig('examples/mobile-flutter/sdkwork.workflow.json');
  const tablet = await loadWorkflowConfig('examples/tablet-cross-platform/sdkwork.workflow.json');

  assert.deepEqual(validateWorkflowConfig(clawRouter), []);
  assert.deepEqual(validateWorkflowConfig(mobile), []);
  assert.deepEqual(validateWorkflowConfig(tablet), []);
});

test('executes lifecycle plan steps with injected package environment', async () => {
  const root = path.join(tempRoot, 'run-lifecycle');
  await rm(root, { recursive: true, force: true });
  await mkdir(path.join(root, 'apps/demo'), { recursive: true });
  const outputPath = path.join(root, 'apps/demo/out.txt');
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'demo', repository: 'Org/demo', sourcePath: 'apps/demo' },
    release: { artifactPrefix: 'demo', defaultVersion: '1.0.0' },
    lifecycle: {
      validate: [
        {
          name: 'Write env file',
          shell: 'node',
          run: `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(outputPath)}, process.env.SDKWORK_PACKAGE_ID);`,
        },
      ],
    },
    targets: [
      {
        id: 'linux-x64-server-tgz',
        packageId: 'linux-x64-server',
        profile: 'server',
        platform: 'linux',
        architecture: 'x64',
        formats: ['tar.gz'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/*.tar.gz'],
      },
    ],
  };
  const [matrixItem] = createPackageMatrix(config, {
    platform: 'linux',
    architecture: 'x64',
    profile: 'server',
    format: 'tar.gz',
  }).include;
  const plan = createLifecyclePlan(config, {
    phase: 'validate',
    matrixItem,
    version: '1.0.0',
    root,
  });

  const result = await runLifecyclePlan(plan, { root });

  assert.equal(result.ok, true);
  assert.equal(result.steps.length, 1);
  assert.equal(await import('node:fs/promises').then((fs) => fs.readFile(outputPath, 'utf8')), 'linux-x64-server');
});
