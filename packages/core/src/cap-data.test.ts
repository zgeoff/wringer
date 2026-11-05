import { expect, onTestFinished, test } from 'bun:test';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { capData } from './cap-data.ts';
import { createNodeRepoHost } from './create-node-repo-host.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'cap-data');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  return {
    capData: (data: unknown) =>
      capData(data, {
        root: directory,
        directory: join(directory, 'payloads'),
        now: () => new Date('2026-11-04T10:00:00.000Z'),
        files: createNodeRepoHost(),
      }),
    readFile: (path: string) => readFile(join(directory, path), 'utf8'),
  };
}

test('it keeps data under the cap in the envelope', async () => {
  const ctx = await setupTest();
  const capped = await ctx.capData({ shelf: 'apples' });

  expect(capped).toStrictEqual({
    data: { shelf: 'apples' },
    evidence: [],
    truncatedPath: null,
    failure: null,
  });
});

test('it moves data over 32768 bytes to a payload file and keeps its path', async () => {
  const ctx = await setupTest();

  const shelf = 'a'.repeat(40_000);

  const capped = await ctx.capData({ shelf });
  const written = await ctx.readFile(capped.truncatedPath ?? '');

  expect({ data: capped.data, written }).toStrictEqual({
    data: null,
    written: JSON.stringify({ shelf }),
  });
});

test('it carries a failure when the data does not serialize', async () => {
  const ctx = await setupTest();
  const capped = await ctx.capData({ count: 1n });

  expect(capped.failure).toMatchObject({ code: 'internal' });
});
