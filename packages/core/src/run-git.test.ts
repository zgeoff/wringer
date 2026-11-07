import { expect, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { runGit, runGitBytes } from './run-git.ts';

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

test("it carries git's exit status and stderr on a failure", async () => {
  const ctx = await setupTest();

  await runGit({ cwd: ctx.directory, args: ['init', '--quiet'] });

  expect(
    runGit({ cwd: ctx.directory, args: ['rev-parse', '--verify', '--quiet', 'refs/heads/none'] }),
  ).rejects.toMatchObject({ code: 'environment', data: { exitCode: 1, stderr: '' } });
});

test("#runGitBytes carries git's exit status and stderr on a failure", async () => {
  const ctx = await setupTest();

  await runGit({ cwd: ctx.directory, args: ['init', '--quiet'] });

  expect(
    runGitBytes({ cwd: ctx.directory, args: ['cat-file', '-p', 'no-such-object'] }),
  ).rejects.toMatchObject({
    code: 'environment',
    data: { exitCode: 128, stderr: 'fatal: Not a valid object name no-such-object\n' },
  });
});

test('#runGitBytes fails with an environment error that names the command when git exits non-zero', async () => {
  const ctx = await setupTest();

  await runGit({ cwd: ctx.directory, args: ['init', '--quiet'] });

  expect(
    runGitBytes({ cwd: ctx.directory, args: ['cat-file', '-p', 'no-such-object'] }),
  ).rejects.toMatchObject({
    code: 'environment',
    message: expect.stringContaining('git cat-file failed:'),
  });
});

test('#runGitBytes returns the bytes git printed', async () => {
  const ctx = await setupTest();

  await runGit({ cwd: ctx.directory, args: ['init', '--quiet'] });

  const bytes = await runGitBytes({
    cwd: ctx.directory,
    args: ['hash-object', '--stdin', '-w'],
    stdin: Buffer.from([0x63, 0x61, 0x66, 0xe9]),
  });

  const id = Buffer.from(bytes).toString().trim();

  const content = await runGitBytes({ cwd: ctx.directory, args: ['cat-file', 'blob', id] });

  expect(Buffer.from(content)).toStrictEqual(Buffer.from([0x63, 0x61, 0x66, 0xe9]));
});

test('it returns the output of a git command that passes', async () => {
  const ctx = await setupTest();

  await runGit({ cwd: ctx.directory, args: ['init', '--quiet'] });

  const result = await runGit({ cwd: ctx.directory, args: ['rev-parse', '--is-inside-work-tree'] });

  expect(result).toStrictEqual({ exitCode: 0, stdout: 'true\n', stderr: '' });
});
