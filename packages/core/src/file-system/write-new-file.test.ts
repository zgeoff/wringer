import { expect, onTestFinished, test } from 'bun:test';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '../test-utils/create-test-folder.ts';
import { writeNewFile } from './write-new-file.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'write-new-file');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return { receiptPath: join(directory, 'receipt.txt') };
}

test('it creates a file that does not exist yet', async () => {
  const ctx = await setupTest();
  const created = await writeNewFile(ctx.receiptPath, Buffer.from('paid 12'));

  expect({ created, text: await readFile(ctx.receiptPath, 'utf8') }).toStrictEqual({
    created: true,
    text: 'paid 12',
  });
});

test('it leaves a file that exists as it is and returns false', async () => {
  const ctx = await setupTest();

  await writeFile(ctx.receiptPath, 'paid 7');

  const created = await writeNewFile(ctx.receiptPath, Buffer.from('paid 12'));

  expect({ created, text: await readFile(ctx.receiptPath, 'utf8') }).toStrictEqual({
    created: false,
    text: 'paid 7',
  });
});
