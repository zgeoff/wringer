import { expect, onTestFinished, test } from 'bun:test';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { $ } from 'bun';
import { writeTreeFiles } from '../test-utils/write-tree-files.ts';

async function setupTest(registryHolds: boolean) {
  const directory = await mkdtemp(join(import.meta.dir, '.test-first-publish-'));

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const repo = join(directory, 'repo');
  const npmLog = join(directory, 'npm.log');

  await writeTreeFiles(repo, {
    'package.json': JSON.stringify({ name: 'kettle-workspace', private: true }),
    'packages/kettle/package.json': JSON.stringify({ name: '@acme/kettle', version: '0.0.0' }),
  });

  // npm stands in for the registry: npm view succeeds only when the registry holds the package,
  // and every call appends its arguments to the log. bun packs for real.
  await writeTreeFiles(directory, {
    'bin/npm': [
      '#!/bin/sh',
      `echo "npm $*" >> '${npmLog}'`,
      `if [ "$1" = view ]; then exit ${registryHolds ? 0 : 1}; fi`,
      '',
    ].join('\n'),
  });

  await chmod(join(directory, 'bin/npm'), 0o755);
  await writeFile(npmLog, '');

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
  const ctx = await setupTest(false);
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
  const ctx = await setupTest(true);
  const result = await ctx.runFirstPublish('kettle');
  const calls = await ctx.readNPMCalls();

  expect(result.exitCode).toBe(1);

  expect(result.stderr.toString()).toBe(
    '@acme/kettle already exists on npm — releases go through CI, not this script\n',
  );

  expect(calls).toBe(['npm whoami', 'npm view @acme/kettle version', ''].join('\n'));
});

test('it refuses a folder that holds no package and runs no npm command', async () => {
  const ctx = await setupTest(false);
  const result = await ctx.runFirstPublish('teapot');
  const calls = await ctx.readNPMCalls();

  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toBe('not a package: packages/teapot\n');
  expect(calls).toBe('');
});
