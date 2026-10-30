import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { $ } from 'bun';
import type { StubNPMAnswer } from '../test-utils/create-stub-npm.ts';
import { createStubNPM } from '../test-utils/create-stub-npm.ts';
import { writeTreeFiles } from '../test-utils/write-tree-files.ts';

async function setupTest(npmAnswers: Readonly<Record<string, StubNPMAnswer>>) {
  const directory = await mkdtemp(join(import.meta.dir, '.test-first-publish-'));

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const repo = join(directory, 'repo');
  const npmLog = join(directory, 'npm.log');

  await writeTreeFiles(repo, {
    'package.json': JSON.stringify({ name: 'kettle-workspace', private: true }),
    'packages/kettle/package.json': JSON.stringify({ name: '@acme/kettle', version: '0.0.0' }),
    'packages/kettle-tools/package.json': JSON.stringify({
      name: '@acme/kettle-tools',
      version: '0.0.0',
      private: true,
    }),
  });

  // npm stands in for the registry and the account; bun packs for real.
  await mkdir(join(directory, 'bin'));
  await writeFile(npmLog, '');
  await createStubNPM(join(directory, 'bin'), npmLog, npmAnswers);

  const scriptPath = join(import.meta.dir, 'first-publish.sh');

  const runFirstPublish = (packageFolder: string) =>
    $`bash ${scriptPath} ${packageFolder}`
      .cwd(repo)
      .env({ ...process.env, PATH: `${join(directory, 'bin')}:${process.env['PATH']}` })
      .nothrow()
      .quiet();

  const readNPMCalls = () => readFile(npmLog, 'utf8');

  return { runFirstPublish, readNPMCalls };
}

test('it packs a package that is new to npm, publishes the tarball, and prints the trusted publisher', async () => {
  const ctx = await setupTest({ view: { exitCode: 1 } });
  const result = await ctx.runFirstPublish('kettle');
  const calls = await ctx.readNPMCalls();

  expect(result.exitCode).toBe(0);

  expect(calls).toBe(
    [
      'npm whoami',
      'npm view @acme/kettle version',
      'npm publish ./acme-kettle-0.0.0.tgz --access public',
      '',
    ].join('\n'),
  );

  expect(result.stdout.toString()).toContain('repository:           wringer\n');
  expect(result.stdout.toString()).toContain('3. Turn on "Allow npm publish" for the publisher.');
  expect(result.stdout.toString()).toContain('4. Release the package from CI within 2 days');
});

test('it refuses a package that npm already holds and publishes nothing', async () => {
  const ctx = await setupTest({ view: { exitCode: 0 } });
  const result = await ctx.runFirstPublish('kettle');
  const calls = await ctx.readNPMCalls();

  expect(result.exitCode).toBe(1);

  expect(result.stderr.toString()).toBe(
    '@acme/kettle already exists on npm — releases go through CI, not this script\n',
  );

  expect(calls).toBe(['npm whoami', 'npm view @acme/kettle version', ''].join('\n'));
});

test('it refuses a folder that holds no package and runs no npm command', async () => {
  const ctx = await setupTest({ view: { exitCode: 1 } });
  const result = await ctx.runFirstPublish('teapot');
  const calls = await ctx.readNPMCalls();

  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toBe('not a package: packages/teapot\n');
  expect(calls).toBe('');
});

test('it refuses a private package and runs no npm command', async () => {
  const ctx = await setupTest({ view: { exitCode: 1 } });
  const result = await ctx.runFirstPublish('kettle-tools');
  const calls = await ctx.readNPMCalls();

  expect(result.exitCode).toBe(1);

  expect(result.stderr.toString()).toBe(
    '@acme/kettle-tools is "private": true — make it publishable first\n',
  );

  expect(calls).toBe('');
});

test('it refuses to publish when npm has no signed-in account', async () => {
  const ctx = await setupTest({ whoami: { exitCode: 1 }, view: { exitCode: 1 } });
  const result = await ctx.runFirstPublish('kettle');
  const calls = await ctx.readNPMCalls();

  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toBe('not logged in to npm — run: npm login\n');
  expect(calls).toBe('npm whoami\n');
});
