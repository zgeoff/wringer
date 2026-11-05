import { expect, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { readText } from '@wringer/core';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { runAppendUnderSizeLimit } from './run-append-under-size-limit.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'run-append-under-size-limit');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const path = join(directory, 'app.ndjson');

  return { path };
}

test('it appends text under 2 KiB and exits 0', async () => {
  const ctx = await setupTest();
  const exitCode = await runAppendUnderSizeLimit(ctx.path, '{"line":"up"}\n');
  const text = await readText(ctx.path);

  expect({ exitCode, text }).toStrictEqual({ exitCode: 0, text: '{"line":"up"}\n' });
});

test('it exits 3 for an append past 2 KiB', async () => {
  const ctx = await setupTest();

  expect(runAppendUnderSizeLimit(ctx.path, 'x'.repeat(4000))).resolves.toBe(3);
});
