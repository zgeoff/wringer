import { expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTempDir } from '@zgeoff/testing/fs';
import { writeNewFile } from './write-new-file.ts';

function setupTest() {
  const directory = createTempDir('write-new-file').path;

  return { receiptPath: join(directory, 'receipt.txt') };
}

test('it creates a file that does not exist yet', async () => {
  const ctx = setupTest();

  const created = await writeNewFile(ctx.receiptPath, Buffer.from('paid 12'));

  expect({ created, text: await readFile(ctx.receiptPath, 'utf8') }).toStrictEqual({
    created: true,
    text: 'paid 12',
  });
});

test('it leaves a file that exists as it is and returns false', async () => {
  const ctx = setupTest();

  await writeFile(ctx.receiptPath, 'paid 7');

  const created = await writeNewFile(ctx.receiptPath, Buffer.from('paid 12'));

  expect({ created, text: await readFile(ctx.receiptPath, 'utf8') }).toStrictEqual({
    created: false,
    text: 'paid 7',
  });
});
