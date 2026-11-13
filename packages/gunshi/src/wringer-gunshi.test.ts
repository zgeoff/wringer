import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runProcess } from '@wringer/core';
import { createTestFolder } from '@wringer/core/test-utils/create-test-folder.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'wringer-gunshi');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return {
    directory,
    runBin: (args: string[]) =>
      runProcess({
        argv: ['bun', join(import.meta.dir, 'wringer-gunshi.ts'), ...args],
        cwd: directory,
      }),
  };
}

test('it installs the packaged skill to --dir and exits 0', async () => {
  const ctx = await setupTest();
  const result = await ctx.runBin(['skill', 'install', '--dir', 'out/wringer']);

  expect(result.exitCode).toBe(0);

  const entries = await readdir(join(ctx.directory, 'out', 'wringer'));

  expect(entries).toIncludeAllMembers(['SKILL.md']);
});

test('it prints usage and exits 2 on an unknown command', async () => {
  const ctx = await setupTest();
  const result = await ctx.runBin(['skill', 'remove']);

  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain('Usage: wringer-gunshi skill install');
});

test('it exits 2 and removes nothing when --dir names a folder of other skills', async () => {
  const ctx = await setupTest();

  await mkdir(join(ctx.directory, '.claude', 'skills', 'verify'), { recursive: true });

  await writeFile(
    join(ctx.directory, '.claude', 'skills', 'verify', 'SKILL.md'),
    '---\nname: verify\n---\n',
  );

  const result = await ctx.runBin(['skill', 'install', '--dir', '.claude/skills']);
  const entries = await readdir(join(ctx.directory, '.claude', 'skills'));

  expect(result.exitCode).toBe(2);
  expect(entries).toStrictEqual(['verify']);
});
