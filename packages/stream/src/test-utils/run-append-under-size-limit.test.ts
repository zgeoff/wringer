import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { readText } from '@wringer/core';
import { createTempDir } from '@zgeoff/testing/fs';
import { runAppendUnderSizeLimit } from './run-append-under-size-limit.ts';

function setupTest() {
  const directory = createTempDir('run-append-under-size-limit').path;
  const path = join(directory, 'app.ndjson');

  return { path };
}

test('it appends text under 2 KiB and exits 0', async () => {
  const ctx = setupTest();

  const exitCode = await runAppendUnderSizeLimit(ctx.path, '{"line":"up"}\n');
  const text = await readText(ctx.path);

  expect({ exitCode, text }).toStrictEqual({ exitCode: 0, text: '{"line":"up"}\n' });
});

test('it exits 3 for an append past 2 KiB', () => {
  const ctx = setupTest();

  expect(runAppendUnderSizeLimit(ctx.path, 'x'.repeat(4000))).resolves.toBe(3);
});
