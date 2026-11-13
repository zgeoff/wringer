import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { envelopeSchema } from '@wringer/core';

// `lint` reads the repo's own files, so the script runs from the repo root, as CI would call it.
test('it passes lint over the shop verify skill and its feature map', async () => {
  const root = join(import.meta.dir, '..', '..', '..');

  const child = Bun.spawn(
    [process.execPath, join(import.meta.dir, 'verify.ts'), 'lint', '--json'],
    {
      cwd: root,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );

  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  expect({ exitCode, data: envelopeSchema.parse(JSON.parse(stdout)).data, stderr }).toStrictEqual({
    exitCode: 0,
    data: { skill: '.claude/skills/verify-shop/SKILL.md', commands: 21, failures: [] },
    stderr: '',
  });
});
