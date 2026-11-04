import { expect, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { runGit } from './run-git.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'run-git');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return { directory };
}

test('it fails with an environment error when git exits non-zero', async () => {
  const ctx = await setupTest();

  await runGit({ cwd: ctx.directory, args: ['init', '--quiet'] });

  expect(
    runGit({ cwd: ctx.directory, args: ['rev-parse', '--verify', 'refs/heads/no-such-branch'] }),
  ).rejects.toMatchObject({ code: 'environment' });
});

test('it returns the output of a git command that passes', async () => {
  const ctx = await setupTest();

  await runGit({ cwd: ctx.directory, args: ['init', '--quiet'] });

  const result = await runGit({ cwd: ctx.directory, args: ['rev-parse', '--is-inside-work-tree'] });

  expect(result).toStrictEqual({ exitCode: 0, stdout: 'true\n', stderr: '' });
});
