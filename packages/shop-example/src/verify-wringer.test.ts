import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { envelopeSchema } from '@wringer/core';
import { z } from 'zod';

function setupTest() {
  // `lint` reads the repo's own files, so the script runs from the repo root, as CI would call it.
  const root = join(import.meta.dir, '..', '..', '..');

  return {
    readLintFailures: async () => {
      const child = Bun.spawn(
        [process.execPath, join(import.meta.dir, 'verify-wringer.ts'), 'lint', '--json'],
        { cwd: root, stdout: 'pipe', stderr: 'pipe' },
      );

      const [stdout] = await Promise.all([new Response(child.stdout).text(), child.exited]);

      const envelope = envelopeSchema.parse(JSON.parse(stdout));
      const failure = z.looseObject({ check: z.string(), where: z.string() });
      const lintData = z.looseObject({ failures: z.array(failure) });

      return lintData.parse(envelope.data).failures;
    },
  };
}

test('it claims every file of the repo with a feature, a shared glob or an ignore glob', async () => {
  const ctx = setupTest();

  const failures = await ctx.readLintFailures();

  expect(
    failures.filter((failure) => ['paths', 'unclaimed'].includes(failure.check)),
  ).toStrictEqual([]);
});

test('it passes lint over wringer verify skill, its feature files and its feature table', async () => {
  const ctx = setupTest();

  const failures = await ctx.readLintFailures();

  expect(failures).toStrictEqual([]);
});
