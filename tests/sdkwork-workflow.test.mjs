import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
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
  createWorkflowSummary,
  createReleaseNotes,
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
        id: 'linux-debian-x64-server-deb',
        profile: 'server',
        platform: 'linux',
        distribution: 'debian',
        architecture: 'x64',
        formats: ['deb'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/install-packages/*.deb', 'dist/install-packages/*.manifest.json'],
      },
      {
        id: 'windows-x64-desktop-msi',
        profile: 'desktop',
        platform: 'windows',
        architecture: 'x64',
        formats: ['msi'],
        runner: 'windows-2022',
        outputGlobs: ['dist/install-packages/*.msi', 'dist/install-packages/*.manifest.json'],
      },
      {
        id: 'android-arm64-mobile-aab',
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
        id: 'linux-x64-server-tar-gz',
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
        id: 'linux-x64-server-tar-gz',
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

test('rejects unknown workflow config properties so schema and planner stay aligned', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    unexpected: true,
    app: { id: 'bad-schema', repository: 'Org/bad-schema', unexpected: true },
    release: { artifactPrefix: 'bad-schema', unexpected: true },
    toolchains: { node: '22', unexpected: true },
    lifecycle: {
      build: [
        {
          run: 'echo build',
          unexpected: true,
        },
      ],
    },
    targets: [
      {
        id: 'linux-x64-server-tar-gz',
        profile: 'server',
        platform: 'linux',
        architecture: 'x64',
        formats: ['tar.gz'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/*.tar.gz'],
        unexpected: true,
      },
    ],
    security: { artifactAttestations: true, unexpected: true },
    publish: { workflowArtifact: true, unexpected: true },
    deployments: [
      {
        id: 'prod',
        environment: 'production',
        unexpected: true,
      },
    ],
  };

  const issues = validateWorkflowConfig(config);
  assert.ok(issues.some((issue) => issue.includes('unexpected is not supported')));
  assert.ok(issues.some((issue) => issue.includes('app.unexpected is not supported')));
  assert.ok(issues.some((issue) => issue.includes('release.unexpected is not supported')));
  assert.ok(issues.some((issue) => issue.includes('toolchains.unexpected is not supported')));
  assert.ok(issues.some((issue) => issue.includes('lifecycle.build[0].unexpected is not supported')));
  assert.ok(issues.some((issue) => issue.includes('targets[0].unexpected is not supported')));
  assert.ok(issues.some((issue) => issue.includes('security.unexpected is not supported')));
  assert.ok(issues.some((issue) => issue.includes('publish.unexpected is not supported')));
  assert.ok(issues.some((issue) => issue.includes('deployments[0].unexpected is not supported')));
});

test('rejects schema-declared type and cardinality violations in planner validation', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'bad-types', name: 42, repository: 'Org/bad-types' },
    release: { artifactPrefix: 'bad-types' },
    toolchains: {
      node: 22,
      android: 'true',
      xcode: 1,
    },
    lifecycle: {
      build: [
        {
          name: 123,
          run: 'echo build',
        },
      ],
    },
    targets: [],
  };

  const issues = validateWorkflowConfig(config);
  assert.ok(issues.some((issue) => issue.includes('app.name must be a non-empty string')));
  assert.ok(issues.some((issue) => issue.includes('toolchains.node must be a string')));
  assert.ok(issues.some((issue) => issue.includes('toolchains.android must be a boolean')));
  assert.ok(issues.some((issue) => issue.includes('toolchains.xcode must be a boolean')));
  assert.ok(issues.some((issue) => issue.includes('lifecycle.build[0].name must be a non-empty string')));
  assert.ok(issues.some((issue) => issue.includes('targets must contain at least 1 item')));
});

test('rejects duplicate target formats before matrix planning', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'duplicate-format', repository: 'Org/duplicate-format' },
    release: { artifactPrefix: 'duplicate-format' },
    targets: [
      {
        id: 'linux-x64-server-zip',
        profile: 'server',
        platform: 'linux',
        architecture: 'x64',
        formats: ['zip', 'zip'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/*.zip'],
      },
    ],
  };

  const issues = validateWorkflowConfig(config);
  assert.ok(issues.some((issue) => issue.includes('targets[0].formats must not contain duplicate values')));
});

test('uses canonical package ids and artifact names for app profiles and platforms', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'demo', repository: 'Org/demo' },
    release: { artifactPrefix: 'demo' },
    targets: [
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
      {
        id: 'windows-x64-desktop',
        profile: 'desktop',
        platform: 'windows',
        architecture: 'x64',
        formats: ['msi', 'exe'],
        runner: 'windows-2022',
        outputGlobs: ['dist/desktop/*'],
      },
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
        id: 'ipados-universal-tablet-ipa',
        profile: 'tablet',
        platform: 'ipados',
        architecture: 'universal',
        formats: ['ipa'],
        runner: 'macos-14',
        outputGlobs: ['build/ipados/ipa/*.ipa'],
      },
    ],
  };

  const matrix = createPackageMatrix(config);

  assert.deepEqual(
    matrix.include.map((item) => [item.packageId, item.artifactName]),
    [
      ['linux-debian-x64-server-deb', 'demo-linux-debian-x64-server-deb'],
      ['linux-rhel-x64-server-rpm', 'demo-linux-rhel-x64-server-rpm'],
      ['linux-x64-server-tar-gz', 'demo-linux-x64-server-tar-gz'],
      ['windows-x64-desktop-msi', 'demo-windows-x64-desktop-msi'],
      ['windows-x64-desktop-exe', 'demo-windows-x64-desktop-exe'],
      ['android-arm64-mobile-aab', 'demo-android-arm64-mobile-aab'],
      ['ipados-universal-tablet-ipa', 'demo-ipados-universal-tablet-ipa'],
    ],
  );
});

test('rejects non-canonical explicit target package ids', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'bad-package-id', repository: 'Org/bad-package-id' },
    release: { artifactPrefix: 'bad-package-id' },
    targets: [
      {
        id: 'linux-debian-x64-server-deb',
        packageId: 'linux-x64-service',
        profile: 'server',
        platform: 'linux',
        distribution: 'debian',
        architecture: 'x64',
        formats: ['deb'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/*.deb'],
      },
    ],
  };

  const issues = validateWorkflowConfig(config);
  assert.ok(issues.some((issue) => issue.includes('targets[0].packageId must be linux-debian-x64-server-deb')));
});

test('rejects non-canonical target ids for single-format targets', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'bad-target-id', repository: 'Org/bad-target-id' },
    release: { artifactPrefix: 'bad-target-id' },
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
  assert.ok(issues.some((issue) => issue.includes('targets[0].id must be linux-x64-server-tar-gz')));
});

test('rejects format-suffixed target ids for multi-format targets', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'bad-target-group-id', repository: 'Org/bad-target-group-id' },
    release: { artifactPrefix: 'bad-target-group-id' },
    targets: [
      {
        id: 'windows-x64-desktop-msi',
        profile: 'desktop',
        platform: 'windows',
        architecture: 'x64',
        formats: ['msi', 'exe'],
        runner: 'windows-2022',
        outputGlobs: ['dist/*'],
      },
    ],
  };

  const issues = validateWorkflowConfig(config);
  assert.ok(issues.some((issue) => issue.includes('targets[0].id must be windows-x64-desktop')));
});

test('rejects linux native package targets without distribution', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'missing-linux-distribution', repository: 'Org/missing-linux-distribution' },
    release: { artifactPrefix: 'missing-linux-distribution' },
    targets: [
      {
        id: 'linux-x64-server-deb',
        profile: 'server',
        platform: 'linux',
        architecture: 'x64',
        formats: ['deb'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/*.deb'],
      },
    ],
  };

  const issues = validateWorkflowConfig(config);
  assert.ok(issues.some((issue) => issue.includes('targets[0].distribution is required for linux deb packages')));
});

test('rejects linux distribution values that do not match the native package format', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'bad-linux-distribution', repository: 'Org/bad-linux-distribution' },
    release: { artifactPrefix: 'bad-linux-distribution' },
    targets: [
      {
        id: 'linux-debian-x64-server-rpm',
        profile: 'server',
        platform: 'linux',
        distribution: 'debian',
        architecture: 'x64',
        formats: ['rpm'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/*.rpm'],
      },
    ],
  };

  const issues = validateWorkflowConfig(config);
  assert.ok(issues.some((issue) => issue.includes('targets[0].distribution debian is not valid for rpm packages')));
});

test('rejects linux distribution on generic archive package targets', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'generic-linux-archive', repository: 'Org/generic-linux-archive' },
    release: { artifactPrefix: 'generic-linux-archive' },
    targets: [
      {
        id: 'linux-x64-server-tar-gz',
        profile: 'server',
        platform: 'linux',
        distribution: 'debian',
        architecture: 'x64',
        formats: ['tar.gz'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/*.tar.gz'],
      },
    ],
  };

  const issues = validateWorkflowConfig(config);
  assert.ok(issues.some((issue) => issue.includes('targets[0].distribution is only valid for linux deb or rpm packages')));
});

test('rejects linux native packages mixed with generic formats in one target', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'mixed-linux-native', repository: 'Org/mixed-linux-native' },
    release: { artifactPrefix: 'mixed-linux-native' },
    targets: [
      {
        id: 'linux-x64-server',
        profile: 'server',
        platform: 'linux',
        distribution: 'debian',
        architecture: 'x64',
        formats: ['deb', 'tar.gz'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/*'],
      },
    ],
  };

  const issues = validateWorkflowConfig(config);
  assert.ok(issues.some((issue) => issue.includes('targets[0].formats must not mix linux native deb/rpm packages with other formats')));
});

test('rejects artifact prefixes that cannot produce canonical artifact names', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'bad-artifact-prefix', repository: 'Org/bad-artifact-prefix' },
    release: { artifactPrefix: 'bad_prefix' },
    targets: [
      {
        id: 'linux-x64-server-tar-gz',
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
  assert.ok(issues.some((issue) => issue.includes('release.artifactPrefix has invalid value')));
});

test('schema declares the instance schema metadata field used by examples', async () => {
  const schema = JSON.parse(await readFile('schemas/sdkwork-workflow.schema.json', 'utf8'));

  assert.equal(schema.properties.$schema.type, 'string');
});

test('schema declares the canonical package id token pattern', async () => {
  const schema = JSON.parse(await readFile('schemas/sdkwork-workflow.schema.json', 'utf8'));

  assert.equal(schema.properties.release.properties.artifactPrefix.pattern, '^[a-z0-9][a-z0-9-]*$');
  assert.equal(schema.properties.targets.items.properties.id.pattern, '^[a-z0-9][a-z0-9-]*$');
  assert.deepEqual(schema.properties.targets.items.properties.distribution.enum, ['debian', 'ubuntu', 'rhel', 'centos', 'fedora', 'opensuse', 'suse']);
  assert.equal(schema.properties.targets.items.properties.packageId.pattern, '^[a-z0-9][a-z0-9-]*$');
  assert.equal(schema.properties.deployments.items.properties.packageId.pattern, '^[a-z0-9][a-z0-9-]*$');
});

test('validates release changelog configuration and schema fields', async () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'release-notes-demo', repository: 'Org/release-notes-demo' },
    release: {
      artifactPrefix: 'release-notes-demo',
      changelog: {
        source: 'file',
        path: 'CHANGELOG.md',
        includeCommitSubjects: false,
        maxCommitSubjects: 25,
      },
    },
    targets: [
      {
        id: 'linux-x64-server-tar-gz',
        profile: 'server',
        platform: 'linux',
        architecture: 'x64',
        formats: ['tar.gz'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/*.tar.gz'],
      },
    ],
  };

  assert.deepEqual(validateWorkflowConfig(config), []);

  const invalid = {
    ...config,
    release: {
      artifactPrefix: 'release-notes-demo',
      changelog: {
        source: 'shell',
        path: '../CHANGELOG.md',
        includeCommitSubjects: 'false',
        maxCommitSubjects: 0,
        unexpected: true,
      },
    },
  };

  const issues = validateWorkflowConfig(invalid);
  assert.ok(issues.some((issue) => issue.includes('release.changelog.source')));
  assert.ok(issues.some((issue) => issue.includes('release.changelog.path')));
  assert.ok(issues.some((issue) => issue.includes('release.changelog.includeCommitSubjects must be a boolean')));
  assert.ok(issues.some((issue) => issue.includes('release.changelog.maxCommitSubjects must be an integer from 1 to 200')));
  assert.ok(issues.some((issue) => issue.includes('release.changelog.unexpected is not supported')));

  const schema = JSON.parse(await readFile('schemas/sdkwork-workflow.schema.json', 'utf8'));
  assert.deepEqual(schema.properties.release.properties.changelog.properties.source.enum, [
    'auto',
    'app-manifest',
    'file',
    'git',
    'none',
  ]);
});

test('renders release notes from sdkwork app manifest notes before git fallback', async () => {
  const root = path.join(tempRoot, 'manifest-release-notes');
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  await writeFile(
    path.join(root, 'sdkwork.app.config.json'),
    JSON.stringify({
      schemaVersion: 3,
      kind: 'sdkwork.app',
      app: {
        key: 'demo-app',
        name: 'Demo App',
      },
      release: {
        notes: [
          {
            version: '1.2.0',
            title: 'Demo App 1.2.0',
            summary: 'Prepared the standard release path.',
            content: 'This release moves packaging onto SDKWork workflow.',
            highlights: ['Unified package naming', 'Release notes generated by workflow'],
          },
        ],
      },
    }, null, 2),
  );

  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: {
      id: 'demo-app',
      name: 'Demo App',
      repository: 'Org/demo-app',
      sourcePath: '.',
      configPath: 'sdkwork.app.config.json',
    },
    release: {
      artifactPrefix: 'demo-app',
      defaultVersion: '1.2.0',
      changelog: {
        source: 'auto',
      },
    },
    targets: [
      {
        id: 'windows-x64-desktop-msi',
        profile: 'desktop',
        platform: 'windows',
        architecture: 'x64',
        formats: ['msi'],
        runner: 'windows-2022',
        outputGlobs: ['dist/*.msi'],
      },
    ],
  };

  const notes = await createReleaseNotes(config, {
    root,
    version: '1.2.0',
    releaseTag: 'v1.2.0',
  });

  assert.equal(notes.source, 'app-manifest');
  assert.match(notes.content, /^# Demo App 1\.2\.0/u);
  assert.match(notes.content, /Prepared the standard release path\./u);
  assert.match(notes.content, /- Unified package naming/u);
  assert.match(notes.content, /windows-x64-desktop-msi/u);
});

test('does not use stale current app manifest notes for a different release version', async () => {
  const root = path.join(tempRoot, 'stale-manifest-release-notes');
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  await writeFile(
    path.join(root, 'sdkwork.app.config.json'),
    JSON.stringify({
      schemaVersion: 3,
      kind: 'sdkwork.app',
      app: {
        key: 'demo-app',
        name: 'Demo App',
      },
      release: {
        notes: [
          {
            version: '1.0.0',
            title: 'Demo App 1.0.0',
            summary: 'Old release note that must not be reused.',
            current: true,
          },
        ],
      },
    }, null, 2),
  );

  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: {
      id: 'demo-app',
      name: 'Demo App',
      repository: 'Org/demo-app',
      sourcePath: '.',
      configPath: 'sdkwork.app.config.json',
    },
    release: {
      artifactPrefix: 'demo-app',
      defaultVersion: '2.0.0',
      changelog: {
        source: 'auto',
      },
    },
    targets: [
      {
        id: 'linux-x64-server-tar-gz',
        profile: 'server',
        platform: 'linux',
        architecture: 'x64',
        formats: ['tar.gz'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/*.tar.gz'],
      },
    ],
  };

  const notes = await createReleaseNotes(config, {
    root,
    version: '2.0.0',
    releaseTag: 'v2.0.0',
  });

  assert.equal(notes.source, 'git');
  assert.match(notes.content, /^# Demo App v2\.0\.0/u);
  assert.doesNotMatch(notes.content, /Demo App 1\.0\.0/u);
  assert.doesNotMatch(notes.content, /Old release note/u);

  await assert.rejects(
    () => createReleaseNotes({
      ...config,
      release: {
        ...config.release,
        changelog: {
          source: 'app-manifest',
        },
      },
    }, {
      root,
      version: '2.0.0',
      releaseTag: 'v2.0.0',
    }),
    /No matching release\.notes entry/u,
  );
});

test('renders release notes from configured changelog file', async () => {
  const root = path.join(tempRoot, 'file-release-notes');
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'CHANGELOG.md'), '# Existing Changelog\n\n- Added packaged app standard.\n');

  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'file-app', name: 'File App', repository: 'Org/file-app' },
    release: {
      artifactPrefix: 'file-app',
      defaultVersion: '2.0.0',
      changelog: {
        source: 'file',
        path: 'CHANGELOG.md',
      },
    },
    targets: [
      {
        id: 'web-noarch-web-static',
        profile: 'web',
        platform: 'web',
        architecture: 'noarch',
        formats: ['static'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/**'],
      },
    ],
  };

  const notes = await createReleaseNotes(config, { root, version: '2.0.0', releaseTag: 'v2.0.0' });

  assert.equal(notes.source, 'file');
  assert.match(notes.content, /^# File App v2\.0\.0/u);
  assert.match(notes.content, /# Existing Changelog/u);
  assert.match(notes.content, /web-noarch-web-static/u);
});

test('rejects unsafe dependency refs and unsupported per-dependency token secret names', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'bad-dependency', repository: 'Org/bad-dependency' },
    release: { artifactPrefix: 'bad-dependency' },
    dependencies: [
      {
        id: 'sdkwork-core',
        repository: 'Sdkwork-Cloud/sdkwork-core',
        ref: '../main',
        refInput: 'SDKWORK_CORE_REF',
        tokenSecret: 'OTHER_TOKEN',
      },
    ],
    targets: [
      {
        id: 'linux-x64-server-tar-gz',
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
  assert.ok(issues.some((issue) => issue.includes('dependencies[0].ref must be a safe git ref')));
  assert.ok(issues.some((issue) => issue.includes('dependencies[0].tokenSecret only supports SDKWORK_RELEASE_TOKEN')));
});

test('rejects dependency checkout paths that collide with application or framework checkouts', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'bad-dependency-paths', repository: 'Org/bad-dependency-paths', sourcePath: 'apps/app' },
    release: { artifactPrefix: 'bad-dependency-paths' },
    dependencies: [
      {
        id: 'app-source',
        repository: 'Sdkwork-Cloud/app-source',
        path: 'apps/app',
      },
      {
        id: 'framework',
        repository: 'Sdkwork-Cloud/framework',
        path: '.sdkwork/github-workflow',
      },
    ],
    targets: [
      {
        id: 'linux-x64-server-tar-gz',
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
  assert.ok(issues.some((issue) => issue.includes('dependencies[0].path must not overlap app.sourcePath')));
  assert.ok(issues.some((issue) => issue.includes('dependencies[1].path must not overlap the framework checkout path')));

  const rootSourceConfig = {
    ...config,
    app: { id: 'root-source', repository: 'Org/root-source' },
    dependencies: [
      {
        id: 'root',
        repository: 'Sdkwork-Cloud/root',
        path: '.',
      },
    ],
  };

  assert.ok(
    validateWorkflowConfig(rootSourceConfig)
      .some((issue) => issue.includes('dependencies[0].path must not overlap app.sourcePath')),
  );
});

test('rejects explicit dependency checkout path when it overlaps application source path', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'default-dependency-path', repository: 'Org/default-dependency-path', sourcePath: 'dependencies/sdkwork-core' },
    release: { artifactPrefix: 'default-dependency-path' },
    dependencies: [
      {
        id: 'sdkwork-core',
        repository: 'Sdkwork-Cloud/sdkwork-core',
        path: 'dependencies/sdkwork-core',
      },
    ],
    targets: [
      {
        id: 'linux-x64-server-tar-gz',
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
  assert.ok(issues.some((issue) => issue.includes('dependencies[0].path must not overlap app.sourcePath')));
});

test('plans default dependency checkout under sdkwork dependencies for repository-root applications', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'repo-root-app', repository: 'Org/repo-root-app', sourcePath: '.' },
    release: { artifactPrefix: 'repo-root-app' },
    dependencies: [
      {
        id: 'sdkwork-core',
        repository: 'Sdkwork-Cloud/sdkwork-core',
        ref: 'main',
      },
    ],
    targets: [
      {
        id: 'linux-x64-server-tar-gz',
        profile: 'server',
        platform: 'linux',
        architecture: 'x64',
        formats: ['tar.gz'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/*.tar.gz'],
      },
    ],
  };

  assert.deepEqual(validateWorkflowConfig(config), []);

  const plan = createDependencyPlan(config);
  assert.equal(plan.include[0].path, '.sdkwork/dependencies/sdkwork-core');
});

test('rejects unsafe lifecycle working directories and non-string step environment values', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'bad-lifecycle', repository: 'Org/bad-lifecycle', sourcePath: '.' },
    release: { artifactPrefix: 'bad-lifecycle' },
    lifecycle: {
      build: [
        {
          run: 'echo build',
          workingDirectory: '../outside',
          env: {
            GOOD_VALUE: 'ok',
            BAD_VALUE: 42,
          },
        },
      ],
    },
    targets: [
      {
        id: 'linux-x64-server-tar-gz',
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
  assert.ok(issues.some((issue) => issue.includes('lifecycle.build[0].workingDirectory must be a safe relative path')));
  assert.ok(issues.some((issue) => issue.includes('lifecycle.build[0].env.BAD_VALUE must be a string')));
});

test('summarizes publication and supply chain policy for reusable workflow jobs', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'policy-demo', repository: 'Org/policy-demo' },
    release: { artifactPrefix: 'policy-demo' },
    targets: [
      {
        id: 'linux-x64-server-tar-gz',
        profile: 'server',
        platform: 'linux',
        architecture: 'x64',
        formats: ['tar.gz'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/*.tar.gz'],
      },
    ],
    security: {
      artifactAttestations: false,
      oidcRequired: true,
    },
    publish: {
      workflowArtifact: false,
      githubRelease: false,
      retentionDays: 7,
    },
  };
  const matrix = createPackageMatrix(config);
  const summary = createWorkflowSummary(config, matrix, { version: '1.2.3' });

  assert.deepEqual(summary.publish, {
    workflowArtifact: false,
    githubRelease: false,
    retentionDays: 7,
  });
  assert.deepEqual(summary.security, {
    oidcRequired: true,
    artifactAttestations: false,
    sbomRequired: false,
    signingRequired: false,
  });
});

test('creates a GitHub Actions matrix filtered by platform, architecture, profile, and format', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'demo', repository: 'Org/demo' },
    release: { artifactPrefix: 'demo' },
    targets: [
      {
        id: 'linux-x64-server-tar-gz',
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
        id: 'linux-x64-desktop',
        profile: 'desktop',
        platform: 'linux',
        architecture: 'x64',
        formats: ['zip', 'tar.gz'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/*'],
      },
    ],
  };

  const matrix = createPackageMatrix(config, { format: 'tar.gz' });
  assert.equal(matrix.include[0].packageId, 'linux-x64-desktop-tar-gz');
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
        id: 'linux-x64-server-tar-gz',
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
        id: 'linux-x64-server-tar-gz',
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
  assert.ok(workflow.includes('push:'));
  assert.ok(workflow.includes('release:'));
  assert.ok(workflow.includes("tag: ${{ github.event.inputs.tag || github.event.release.tag_name || github.ref_name }}"));
  assert.ok(workflow.includes("package_version: ${{ github.event.inputs.package_version || github.event.release.tag_name || github.ref_name }}"));
  assert.ok(workflow.includes("deploy: ${{ github.event.inputs.deploy == 'true' || github.event_name == 'release' }}"));
  assert.ok(workflow.includes('Sdkwork-Cloud/sdkwork-github-workflow/.github/workflows/sdkwork-package.yml@v1'));
  assert.ok(workflow.includes('dependency_refs_json: >-'));
  assert.ok(workflow.includes('SDKWORK_APPBASE_REF'));

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

test('init-app generates standard linux native and windows installer package targets', async () => {
  const root = path.join(tempRoot, 'init-app-standard-package-targets');
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  await initApplicationWorkflow({
    root,
    appId: 'standard-targets',
    repository: 'Sdkwork-Cloud/standard-targets',
    profiles: ['server', 'desktop'],
    frameworkRef: 'v1',
  });

  const config = await loadWorkflowConfig(path.join(root, 'sdkwork.workflow.json'));
  assert.deepEqual(validateWorkflowConfig(config), []);
  const matrix = createPackageMatrix(config, { platform: 'all', architecture: 'all', profile: 'all', format: 'all' });
  const packageIds = matrix.include.map((item) => item.packageId);

  assert.ok(packageIds.includes('linux-debian-x64-server-deb'));
  assert.ok(packageIds.includes('linux-rhel-x64-server-rpm'));
  assert.ok(packageIds.includes('linux-x64-server-tar-gz'));
  assert.ok(packageIds.includes('windows-x64-desktop-msi'));
  assert.ok(packageIds.includes('windows-x64-desktop-exe'));
  assert.equal(matrix.include.find((item) => item.packageId === 'linux-debian-x64-server-deb')?.distribution, 'debian');
  assert.equal(matrix.include.find((item) => item.packageId === 'linux-rhel-x64-server-rpm')?.distribution, 'rhel');
});

test('init-app generates shell-neutral lifecycle placeholders', async () => {
  const root = path.join(tempRoot, 'init-app-shell-neutral-lifecycle');
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  await initApplicationWorkflow({
    root,
    appId: 'shell-neutral',
    repository: 'Sdkwork-Cloud/shell-neutral',
    profiles: ['server', 'desktop'],
    frameworkRef: 'v1',
  });

  const config = await loadWorkflowConfig(path.join(root, 'sdkwork.workflow.json'));
  const steps = Object.values(config.lifecycle).flat();

  assert.ok(steps.length > 0);
  for (const step of steps) {
    assert.equal(step.shell, 'node');
    assert.match(step.run, /process\.env\.SDKWORK_/u);
    assert.doesNotMatch(step.run, /\$SDKWORK_/u);
    assert.doesNotMatch(step.run, /\$env:SDKWORK_/u);
  }
});

test('init-app renders the checked-in application workflow template', async () => {
  const root = path.join(tempRoot, 'init-app-template');
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  await initApplicationWorkflow({
    root,
    appId: 'template-demo',
    repository: 'Sdkwork-Cloud/template-demo',
    profiles: ['server'],
    frameworkRef: 'v1',
  });

  const generated = await readFile(path.join(root, '.github/workflows/package.yml'), 'utf8');
  const template = await readFile('templates/app-package.workflow.yml', 'utf8');

  assert.equal(generated, template);
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
        id: 'linux-x64-server-tar-gz',
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

test('setup-toolchains action consumes every declared toolchain output', async () => {
  const action = await readFile('actions/setup-toolchains/action.yml', 'utf8');

  assert.match(action, /if: steps\.read\.outputs\.dotnet != ''/u);
  assert.match(action, /uses: actions\/setup-dotnet@v4/u);
  assert.match(action, /if: steps\.read\.outputs\.android == 'true'/u);
  assert.match(action, /uses: android-actions\/setup-android@v3/u);
  assert.match(action, /if: steps\.read\.outputs\.xcode == 'true'/u);
  assert.match(action, /uses: maxim-lobanov\/setup-xcode@v1/u);
});

test('shell-based composite actions do not embed action input expressions in scripts', async () => {
  const { extractLiteralRunBlocks } = await import('../scripts/validate-repository.mjs');
  const actionPaths = [
    'actions/validate-config/action.yml',
    'actions/setup-toolchains/action.yml',
    'actions/run-lifecycle/action.yml',
    'actions/publish-release/action.yml',
    'actions/checkout-dependencies/action.yml',
  ];

  for (const actionPath of actionPaths) {
    const action = await readFile(actionPath, 'utf8');
    const runBlocks = extractLiteralRunBlocks(action);
    for (const runBlock of runBlocks) {
      assert.doesNotMatch(runBlock, /\$\{\{\s*inputs\./u, `${actionPath} embeds action input expression in a shell script`);
    }
  }
});

test('creates deployment matrix from declared environments and selected package targets', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'demo', repository: 'Org/demo' },
    release: { artifactPrefix: 'demo' },
    targets: [
      {
        id: 'linux-x64-server-tar-gz',
        packageId: 'linux-x64-server-tar-gz',
        profile: 'server',
        platform: 'linux',
        architecture: 'x64',
        formats: ['tar.gz'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/*.tar.gz'],
      },
      {
        id: 'windows-x64-desktop-msi',
        packageId: 'windows-x64-desktop-msi',
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
        targetId: 'linux-x64-server-tar-gz',
        packageId: 'linux-x64-server-tar-gz',
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
        id: 'linux-x64-server-tar-gz',
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
        packageId: 'linux_x64_server_deb',
        lifecycle: 'ship',
      },
    ],
  };

  const issues = validateWorkflowConfig(config);
  assert.ok(issues.some((issue) => issue.includes('deployments[0].environment')));
  assert.ok(issues.some((issue) => issue.includes('deployments[0].packageId has invalid value')));
  assert.ok(issues.some((issue) => issue.includes('deployments[0].lifecycle')));
});

test('rejects deployments that cannot bind to any package target', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'bad-deploy-selector', repository: 'Org/bad-deploy-selector' },
    release: { artifactPrefix: 'bad-deploy-selector' },
    targets: [
      {
        id: 'linux-x64-server-tar-gz',
        packageId: 'linux-x64-server-tar-gz',
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
        id: 'production',
        environment: 'production',
        targetId: 'windows-x64-desktop-msi',
      },
    ],
  };

  const issues = validateWorkflowConfig(config);
  assert.ok(issues.some((issue) => issue.includes('deployments[0] does not match any package target')));
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
        id: 'linux-x64-server-tar-gz',
        packageId: 'linux-x64-server-tar-gz',
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
          SDKWORK_PACKAGE_ID: 'linux-x64-server-tar-gz',
          SDKWORK_PACKAGE_PLATFORM: 'linux',
          SDKWORK_PACKAGE_PROFILE: 'server',
          SDKWORK_PACKAGE_TARGET_ID: 'linux-x64-server-tar-gz',
          SDKWORK_PACKAGE_VERSION: '9.9.9',
          SDKWORK_RELEASE_TAG: 'v9.9.9',
        },
      },
    ],
  });
});

test('creates lifecycle command plan with linux distribution environment', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'linux-native-demo', repository: 'Org/linux-native-demo' },
    release: { artifactPrefix: 'linux-native-demo', defaultVersion: '1.2.3' },
    lifecycle: {
      package: [{ run: 'echo "$SDKWORK_PACKAGE_DISTRIBUTION $SDKWORK_PACKAGE_FORMAT"' }],
    },
    targets: [
      {
        id: 'linux-debian-x64-server-deb',
        profile: 'server',
        platform: 'linux',
        distribution: 'debian',
        architecture: 'x64',
        formats: ['deb'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/*.deb'],
      },
    ],
  };

  const matrix = createPackageMatrix(config, { platform: 'linux', architecture: 'x64', profile: 'server', format: 'deb' });
  const plan = createLifecyclePlan(config, {
    phase: 'package',
    matrixItem: matrix.include[0],
    version: '1.2.3',
  });

  assert.equal(matrix.include[0].distribution, 'debian');
  assert.equal(plan.steps[0].env.SDKWORK_PACKAGE_DISTRIBUTION, 'debian');
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
        id: 'linux-x64-server-tar-gz',
        packageId: 'linux-x64-server-tar-gz',
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
      id: 'linux-x64-server-tar-gz',
      packageId: 'linux-x64-server-tar-gz',
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

test('passes linux distribution through deployment lifecycle matrix items', () => {
  const config = {
    schemaVersion: '2026-06-06.sdkwork.workflow.v1',
    app: { id: 'linux-native-deploy', repository: 'Org/linux-native-deploy' },
    release: { artifactPrefix: 'linux-native-deploy', defaultVersion: '1.2.3' },
    lifecycle: {
      deploy: [{ run: 'echo "$SDKWORK_PACKAGE_DISTRIBUTION"' }],
    },
    targets: [
      {
        id: 'linux-debian-x64-server-deb',
        profile: 'server',
        platform: 'linux',
        distribution: 'debian',
        architecture: 'x64',
        formats: ['deb'],
        runner: 'ubuntu-24.04',
        outputGlobs: ['dist/*.deb'],
      },
    ],
    deployments: [
      {
        id: 'production',
        environment: 'production',
        packageId: 'linux-debian-x64-server-deb',
      },
    ],
  };

  const packageMatrix = createPackageMatrix(config, { format: 'deb' });
  const deploymentMatrix = createDeploymentMatrix(config, { packageMatrix });
  const plan = createLifecyclePlan(config, {
    phase: 'deploy',
    matrixItem: deploymentMatrix.include[0],
    version: '1.2.3',
  });

  assert.equal(deploymentMatrix.include[0].distribution, 'debian');
  assert.equal(plan.steps[0].env.SDKWORK_PACKAGE_DISTRIBUTION, 'debian');
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
        id: 'windows-tablet-x64-tablet-msix',
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
        id: 'linux-x64-server-tar-gz',
        packageId: 'linux-x64-server-tar-gz',
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
  assert.equal(await import('node:fs/promises').then((fs) => fs.readFile(outputPath, 'utf8')), 'linux-x64-server-tar-gz');
});

test('repository validation requires SDKWork workspace metadata files', async () => {
  const { REQUIRED_FILES } = await import('../scripts/validate-repository.mjs');

  assert.ok(REQUIRED_FILES.includes('AGENTS.md'));
  assert.ok(REQUIRED_FILES.includes('CLAUDE.md'));
  assert.ok(REQUIRED_FILES.includes('.sdkwork/README.md'));
  assert.ok(REQUIRED_FILES.includes('.sdkwork/.gitignore'));
  assert.ok(REQUIRED_FILES.includes('.sdkwork/skills/README.md'));
  assert.ok(REQUIRED_FILES.includes('.sdkwork/plugins/README.md'));
});

test('repository validation rejects shell-quoted dependency refs JSON expressions', async () => {
  const root = path.join(tempRoot, 'repository-validation-yaml');
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  const workflowPath = path.join(root, 'workflow.yml');
  await writeFile(workflowPath, `
name: Bad Workflow
jobs:
  plan:
    steps:
      - shell: bash
        run: |
          node scripts/sdkwork-workflow.mjs dependencies \\
            --dependency-refs-json '\${{ inputs.dependency_refs_json }}'
`);

  const { validateYamlText } = await import('../scripts/validate-repository.mjs');
  const issues = [];
  validateYamlText(workflowPath, issues);

  assert.ok(issues.some((issue) => issue.includes('must pass dependency_refs_json through an environment variable')));
});

test('repository validation rejects action input expressions inside shell scripts', async () => {
  const root = path.join(tempRoot, 'repository-validation-input-expression');
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  const workflowPath = path.join(root, 'action.yml');
  await writeFile(workflowPath, `
name: Bad Action
runs:
  using: composite
  steps:
    - shell: bash
      run: |
        echo "\${{ inputs.config-path }}"
`);

  const { validateYamlText } = await import('../scripts/validate-repository.mjs');
  const issues = [];
  validateYamlText(workflowPath, issues);

  assert.ok(issues.some((issue) => issue.includes('must not embed action input expressions in shell scripts')));
});

test('repository validation only scans literal run blocks for action input expressions', async () => {
  const root = path.join(tempRoot, 'repository-validation-run-block-boundary');
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  const workflowPath = path.join(root, 'workflow.yml');
  await writeFile(workflowPath, `
name: Good Workflow
jobs:
  plan:
    steps:
      - shell: bash
        env:
          SDKWORK_CONFIG_PATH: \${{ inputs.config_path }}
        run: |
          node scripts/sdkwork-workflow.mjs matrix --config "$SDKWORK_CONFIG_PATH"

      - uses: ./actions/validate-config
        with:
          config-path: \${{ inputs.config_path }}
`);

  const { validateYamlText } = await import('../scripts/validate-repository.mjs');
  const issues = [];
  validateYamlText(workflowPath, issues);

  assert.deepEqual(issues, []);
});

test('publish-release action passes workflow inputs through environment variables', async () => {
  const action = await readFile('actions/publish-release/action.yml', 'utf8');

  assert.match(action, /SDKWORK_RELEASE_TAG: \$\{\{ inputs\.tag \}\}/u);
  assert.match(action, /SDKWORK_RELEASE_REPOSITORY: \$\{\{ inputs\.repository \}\}/u);
  assert.match(action, /SDKWORK_RELEASE_CLOBBER: \$\{\{ inputs\.clobber \}\}/u);
  assert.match(action, /SDKWORK_RELEASE_NOTES_FILE: \$\{\{ inputs\.notes-file \}\}/u);
  assert.match(action, /\$tag = \$env:SDKWORK_RELEASE_TAG/u);
  assert.match(action, /\$repo = \$env:SDKWORK_RELEASE_REPOSITORY/u);
  assert.match(action, /\$notesFile = \$env:SDKWORK_RELEASE_NOTES_FILE/u);
  assert.match(action, /gh release create \$tag --repo \$repo --title \$tag --notes-file \$notesFile/u);
  assert.match(action, /gh release edit \$tag --repo \$repo --notes-file \$notesFile/u);
  assert.doesNotMatch(action, /\$tag = "\$\{\{ inputs\.tag \}\}"/u);
  assert.doesNotMatch(action, /--repo "\$\{\{ inputs\.repository \}\}"/u);
});

test('reusable workflow gates publication policies and passes deployment context explicitly', async () => {
  const workflow = await readFile('.github/workflows/sdkwork-package.yml', 'utf8');

  assert.match(workflow, /if: \$\{\{ inputs\.upload_artifact && fromJson\(needs\.plan\.outputs\.summary_json\)\.publish\.workflowArtifact \}\}/u);
  assert.match(workflow, /retention-days: \$\{\{ fromJson\(needs\.plan\.outputs\.summary_json\)\.publish\.retentionDays \|\| inputs\.retention_days \}\}/u);
  assert.match(workflow, /if: \$\{\{ fromJson\(needs\.plan\.outputs\.summary_json\)\.security\.artifactAttestations \}\}/u);
  assert.match(workflow, /if: \$\{\{ inputs\.publish_release && fromJson\(needs\.plan\.outputs\.summary_json\)\.publish\.githubRelease \}\}/u);
  assert.match(workflow, /name: Render release changelog/u);
  assert.match(workflow, /notes-file: \$\{\{ steps\.changelog\.outputs\.notes_path \}\}/u);
  assert.match(workflow, /deploy-environment: \$\{\{ matrix\.environment \}\}/u);
  assert.match(workflow, /deploy-url: \$\{\{ matrix\.url \}\}/u);
  assert.match(workflow, /deploy-lifecycle: \$\{\{ matrix\.lifecycle \}\}/u);
});

test('reusable workflow passes dependency refs JSON through an environment variable', async () => {
  const workflow = await readFile('.github/workflows/sdkwork-package.yml', 'utf8');

  assert.match(workflow, /SDKWORK_DEPENDENCY_REFS_JSON: \$\{\{ inputs\.dependency_refs_json \}\}/u);
  assert.match(workflow, /--dependency-refs-json "\$\{SDKWORK_DEPENDENCY_REFS_JSON\}"/u);
  assert.doesNotMatch(workflow, /--dependency-refs-json '\$\{\{ inputs\.dependency_refs_json \}\}'/u);
});
