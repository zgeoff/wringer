import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createStubCommand } from '../../test-utils/create-stub-command.ts';
import { createStubNPM } from '../../test-utils/create-stub-npm.ts';
import { writeTreeFiles } from '../../test-utils/write-tree-files.ts';
import { nodeFileSystem } from '../ci/node-file-system.ts';
import { runCommand } from '../ci/run-command.ts';
import { publishPackages } from './publish-packages.ts';

async function setupTest() {
  const directory = await mkdtemp(join(import.meta.dir, '.test-publish-packages-'));

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const bin = join(directory, 'bin');
  const repo = join(directory, 'repo');
  const npmLog = join(directory, 'npm.log');

  await mkdir(bin);
  await mkdir(repo);
  await writeFile(npmLog, '');

  // npm stands in for the registry, and prints the given answer to npm view; bun packs for real.
  const createNPM = (viewOutput: string) => createStubCommand(bin, 'npm', npmLog, viewOutput);
  const output: string[] = [];
  const errors: string[] = [];
  const loggedCalls: string[][] = [];

  const runPublish = (paths: readonly string[], releasedVersions: string, modeText = '') =>
    publishPackages({
      modeText,
      cwd: repo,
      env: { PATH: `${bin}:${process.env['PATH']}`, HOME: directory },
      pathsText: JSON.stringify(paths),
      releasedVersionsText: releasedVersions,
      fileSystem: nodeFileSystem,
      runCommand,
      runLoggedCommand: (argv, options) => {
        loggedCalls.push([...argv]);

        return runCommand(argv, options);
      },
      writeOutput: (text) => {
        output.push(text);
      },
      writeError: (text) => {
        errors.push(text);
      },
    });

  const readNPMCalls = () => readFile(npmLog, 'utf8');

  // npm stands in for a registry that refuses every publish.
  const createRefusingNPM = () => createStubNPM(bin, npmLog, { publish: { exitCode: 1 } });

  return {
    repo,
    output,
    errors,
    loggedCalls,
    createNPM,
    createRefusingNPM,
    runPublish,
    readNPMCalls,
  };
}

test('it packs and publishes each released package with provenance', async () => {
  const ctx = await setupTest();

  await ctx.createNPM('');

  await writeTreeFiles(ctx.repo, {
    'packages/std/package.json': JSON.stringify({ name: '@zgeoff/std', version: '0.4.0' }),
  });

  const exitCode = await ctx.runPublish(['packages/std'], '{"packages/std":"0.4.0"}');
  const calls = await ctx.readNPMCalls();

  expect(exitCode).toBe(0);
  expect(ctx.output).toStrictEqual([]);

  expect(calls).toBe(
    [
      'npm view @zgeoff/std@0.4.0 version',
      'npm publish ./zgeoff-std-0.4.0.tgz --provenance --access public',
      '',
    ].join('\n'),
  );
});

test('it publishes the given paths in a republish by hand, which names no released versions', async () => {
  const ctx = await setupTest();

  await ctx.createNPM('');

  await writeTreeFiles(ctx.repo, {
    'packages/std/package.json': JSON.stringify({ name: '@zgeoff/std', version: '0.4.0' }),
  });

  const exitCode = await ctx.runPublish(['packages/std'], '');
  const calls = await ctx.readNPMCalls();

  expect(exitCode).toBe(0);

  expect(calls).toBe(
    [
      'npm view @zgeoff/std@0.4.0 version',
      'npm publish ./zgeoff-std-0.4.0.tgz --provenance --access public',
      '',
    ].join('\n'),
  );
});

test('it skips a private root with no version and publishes the rest of a republish batch', async () => {
  const ctx = await setupTest();

  await ctx.createNPM('');

  await writeTreeFiles(ctx.repo, {
    'package.json': JSON.stringify({ name: 'kettle-workspace', private: true }),
    'packages/std/package.json': JSON.stringify({ name: '@zgeoff/std', version: '0.4.0' }),
  });

  const exitCode = await ctx.runPublish(['.', 'packages/std'], '');
  const calls = await ctx.readNPMCalls();

  expect(exitCode).toBe(0);

  expect(calls).toBe(
    [
      'npm view @zgeoff/std@0.4.0 version',
      'npm publish ./zgeoff-std-0.4.0.tgz --provenance --access public',
      '',
    ].join('\n'),
  );

  expect(ctx.output).toContain('skipping kettle-workspace: private\n');
});

test('it refuses to publish any package when one holds a version the release did not tag', async () => {
  const ctx = await setupTest();

  await ctx.createNPM('');

  await writeTreeFiles(ctx.repo, {
    'packages/std/package.json': JSON.stringify({ name: '@zgeoff/std', version: '0.4.0' }),
    'packages/tsconfig/package.json': JSON.stringify({
      name: '@zgeoff/tsconfig',
      version: '1.1.9',
    }),
  });

  const exitCode = await ctx.runPublish(
    ['packages/std', 'packages/tsconfig'],
    '{"packages/std":"0.4.0","packages/tsconfig":"1.2.0"}',
  );

  const calls = await ctx.readNPMCalls();

  expect(exitCode).toBe(1);

  expect(ctx.errors).toStrictEqual([
    `::error::@zgeoff/tsconfig: the release tagged 1.2.0 but ${join(ctx.repo, 'packages/tsconfig/package.json')} holds 1.1.9\n`,
  ]);

  expect(calls).toBe('');
});

test('it rehearses a prerelease of each version with a dry-run publish and no provenance, even one the registry holds', async () => {
  const ctx = await setupTest();

  await ctx.createNPM('0.4.0\n');

  await writeTreeFiles(ctx.repo, {
    'packages/std/package.json': JSON.stringify({ name: '@zgeoff/std', version: '0.4.0' }),
  });

  const exitCode = await ctx.runPublish(['packages/std'], '', 'rehearse');
  const calls = await ctx.readNPMCalls();

  expect(exitCode).toBe(0);
  expect(ctx.output).toStrictEqual([]);

  expect(calls).toBe(
    'npm publish ./zgeoff-std-0.4.0-rehearsal.tgz --dry-run --tag rehearsal --access public\n',
  );
});

test('it puts the package manifest back as it was after a rehearsal', async () => {
  const ctx = await setupTest();

  await ctx.createNPM('');

  const manifestText = JSON.stringify({ name: '@zgeoff/std', version: '0.4.0' });

  await writeTreeFiles(ctx.repo, { 'packages/std/package.json': manifestText });

  const exitCode = await ctx.runPublish(['packages/std'], '', 'rehearse');
  const restored = await readFile(join(ctx.repo, 'packages/std/package.json'), 'utf8');

  expect(exitCode).toBe(0);
  expect(restored).toBe(manifestText);
});

test('it removes the tarball after the publish, so a second run in the same tree packs one tarball', async () => {
  const ctx = await setupTest();

  await ctx.createNPM('');

  await writeTreeFiles(ctx.repo, {
    'packages/std/package.json': JSON.stringify({ name: '@zgeoff/std', version: '0.4.0' }),
  });

  const firstExitCode = await ctx.runPublish(['packages/std'], '', 'rehearse');
  const secondExitCode = await ctx.runPublish(['packages/std'], '', 'rehearse');
  const files = await readdir(join(ctx.repo, 'packages/std'));

  expect([firstExitCode, secondExitCode]).toStrictEqual([0, 0]);
  expect(files).toStrictEqual(['package.json']);
});

test('it removes the tarball when npm refuses the publish', async () => {
  const ctx = await setupTest();

  await ctx.createRefusingNPM();

  await writeTreeFiles(ctx.repo, {
    'packages/std/package.json': JSON.stringify({ name: '@zgeoff/std', version: '0.4.0' }),
  });

  expect(ctx.runPublish(['packages/std'], '', 'rehearse')).rejects.toThrow(
    'npm publish ./zgeoff-std-0.4.0-rehearsal.tgz',
  );

  const files = await readdir(join(ctx.repo, 'packages/std'));

  expect(files).toStrictEqual(['package.json']);
});

test('it puts the package manifest back when the rehearsal pack fails', async () => {
  const ctx = await setupTest();

  await ctx.createNPM('');

  const manifestText = JSON.stringify({
    name: '@zgeoff/std',
    version: '0.4.0',
    scripts: { prepack: 'exit 1' },
  });

  await writeTreeFiles(ctx.repo, { 'packages/std/package.json': manifestText });

  expect(ctx.runPublish(['packages/std'], '', 'rehearse')).rejects.toThrow('bun pm pack');

  const restored = await readFile(join(ctx.repo, 'packages/std/package.json'), 'utf8');

  expect(restored).toBe(manifestText);
});

test('it rehearses every folder under packages when the rehearsal lists no paths', async () => {
  const ctx = await setupTest();

  await ctx.createNPM('');

  await writeTreeFiles(ctx.repo, {
    'packages/std/package.json': JSON.stringify({ name: '@zgeoff/std', version: '0.4.0' }),
    'packages/kettle/package.json': JSON.stringify({ name: '@acme/kettle', version: '2.0.0' }),
  });

  const exitCode = await ctx.runPublish([], '', 'rehearse');
  const calls = await ctx.readNPMCalls();

  expect(exitCode).toBe(0);

  expect(calls).toBe(
    [
      'npm publish ./acme-kettle-2.0.0-rehearsal.tgz --dry-run --tag rehearsal --access public',
      'npm publish ./zgeoff-std-0.4.0-rehearsal.tgz --dry-run --tag rehearsal --access public',
      '',
    ].join('\n'),
  );
});

test('it refuses a publish mode other than publish or rehearse and runs no npm command', async () => {
  const ctx = await setupTest();

  await ctx.createNPM('');

  await writeTreeFiles(ctx.repo, {
    'packages/std/package.json': JSON.stringify({ name: '@zgeoff/std', version: '0.4.0' }),
  });

  const exitCode = await ctx.runPublish(['packages/std'], '', 'dry-run');
  const calls = await ctx.readNPMCalls();

  expect(exitCode).toBe(1);
  expect(ctx.errors).toStrictEqual(['::error::PUBLISH_MODE holds neither publish nor rehearse\n']);
  expect(calls).toBe('');
});

test('it skips a private package without asking the registry', async () => {
  const ctx = await setupTest();

  await ctx.createNPM('');

  await writeTreeFiles(ctx.repo, {
    'packages/kettle/package.json': JSON.stringify({
      name: '@acme/kettle',
      version: '2.0.0',
      private: true,
    }),
  });

  const exitCode = await ctx.runPublish(['packages/kettle'], '');
  const calls = await ctx.readNPMCalls();

  expect(exitCode).toBe(0);
  expect(ctx.output).toStrictEqual(['skipping @acme/kettle: private\n']);
  expect(calls).toBe('');
});

test('it skips a package whose version the registry already holds', async () => {
  const ctx = await setupTest();

  await ctx.createNPM('0.4.0\n');

  await writeTreeFiles(ctx.repo, {
    'packages/std/package.json': JSON.stringify({ name: '@zgeoff/std', version: '0.4.0' }),
  });

  const exitCode = await ctx.runPublish(['packages/std'], '');
  const calls = await ctx.readNPMCalls();

  expect(exitCode).toBe(0);
  expect(ctx.output).toStrictEqual(['skipping @zgeoff/std@0.4.0: already published\n']);
  expect(calls).toBe('npm view @zgeoff/std@0.4.0 version\n');
});

test('it builds a package that defines a build script before it packs it', async () => {
  const ctx = await setupTest();

  await ctx.createNPM('');

  await writeTreeFiles(ctx.repo, {
    'packages/std/package.json': JSON.stringify({
      name: '@zgeoff/std',
      version: '0.4.0',
      files: ['dist'],
      scripts: { build: 'mkdir -p dist && echo built > dist/index.js' },
    }),
  });

  const exitCode = await ctx.runPublish(['packages/std'], '');
  const built = await readFile(join(ctx.repo, 'packages/std/dist/index.js'), 'utf8');

  expect(exitCode).toBe(0);
  expect(built).toBe('built\n');
});

test('it runs the build, pack and publish through the runner that streams their output to the log', async () => {
  const ctx = await setupTest();

  await ctx.createNPM('');

  await writeTreeFiles(ctx.repo, {
    'packages/std/package.json': JSON.stringify({
      name: '@zgeoff/std',
      version: '0.4.0',
      scripts: { build: 'echo built' },
    }),
  });

  const exitCode = await ctx.runPublish(['packages/std'], '');

  expect(exitCode).toBe(0);

  expect(ctx.loggedCalls).toStrictEqual([
    ['bun', 'run', 'build'],
    ['bun', 'pm', 'pack'],
    ['npm', 'publish', './zgeoff-std-0.4.0.tgz', '--provenance', '--access', 'public'],
  ]);

  expect(ctx.output).toStrictEqual([]);
});

test('it refuses a paths list that is not a JSON array and publishes nothing', async () => {
  const ctx = await setupTest();

  const exitCode = await publishPackages({
    modeText: '',
    cwd: ctx.repo,
    env: {},
    pathsText: 'packages/std',
    releasedVersionsText: '',
    fileSystem: nodeFileSystem,
    runCommand,
    runLoggedCommand: runCommand,
    writeOutput: () => {},
    writeError: (text) => {
      ctx.errors.push(text);
    },
  });

  expect(exitCode).toBe(1);

  expect(ctx.errors).toStrictEqual([
    '::error::PATHS_RELEASED holds no JSON array of paths, or RELEASED_VERSIONS no JSON object of versions\n',
  ]);
});

test('it refuses a released versions value that is not a JSON object and publishes nothing', async () => {
  const ctx = await setupTest();

  await ctx.createNPM('');

  const exitCode = await ctx.runPublish(['packages/std'], '["0.4.0"]');
  const calls = await ctx.readNPMCalls();

  expect(exitCode).toBe(1);

  expect(ctx.errors).toStrictEqual([
    '::error::PATHS_RELEASED holds no JSON array of paths, or RELEASED_VERSIONS no JSON object of versions\n',
  ]);

  expect(calls).toBe('');
});

test('it refuses a package.json that holds no JSON object and runs no npm command', async () => {
  const ctx = await setupTest();

  await ctx.createNPM('');

  await writeTreeFiles(ctx.repo, { 'packages/std/package.json': 'null' });

  const exitCode = await ctx.runPublish(['packages/std'], '');
  const calls = await ctx.readNPMCalls();

  expect(exitCode).toBe(1);

  expect(ctx.errors).toStrictEqual([
    `::error::${join(ctx.repo, 'packages/std')}/package.json holds no JSON object\n`,
  ]);

  expect(calls).toBe('');
});

test('it refuses a package.json with no version and runs no npm command', async () => {
  const ctx = await setupTest();

  await ctx.createNPM('');

  await writeTreeFiles(ctx.repo, {
    'packages/std/package.json': JSON.stringify({ name: '@zgeoff/std' }),
  });

  const exitCode = await ctx.runPublish(['packages/std'], '');
  const calls = await ctx.readNPMCalls();

  expect(exitCode).toBe(1);

  expect(ctx.errors).toStrictEqual([
    `::error::${join(ctx.repo, 'packages/std')}/package.json names no package and version\n`,
  ]);

  expect(calls).toBe('');
});

test('it refuses to publish when the pack leaves more than one tarball', async () => {
  const ctx = await setupTest();

  await ctx.createNPM('');

  await writeTreeFiles(ctx.repo, {
    'packages/std/package.json': JSON.stringify({ name: '@zgeoff/std', version: '0.4.0' }),
    'packages/std/zgeoff-std-0.3.9.tgz': 'an older pack',
  });

  expect(ctx.runPublish(['packages/std'], '')).rejects.toThrow(
    `bun pm pack left 2 tarballs in ${join(ctx.repo, 'packages/std')}`,
  );

  const calls = await ctx.readNPMCalls();

  expect(calls).toBe('npm view @zgeoff/std@0.4.0 version\n');
});
