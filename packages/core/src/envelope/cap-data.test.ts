import { expect, test } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTempDir } from '@zgeoff/testing/fs';
import { createNodeRepoHost } from '../repo-host/create-node-repo-host.ts';
import { createSecretSet } from '../secrets/create-secret-set.ts';
import { capData } from './cap-data.ts';

function setupTest() {
  const directory = createTempDir('cap-data').path;

  return {
    capData: (data: unknown) =>
      capData(data, {
        root: directory,
        directory: join(directory, 'payloads'),
        now: () => new Date('2026-11-04T10:00:00.000Z'),
        files: createNodeRepoHost(),
        secrets: createSecretSet(),
      }),
    readFile: (path: string) => readFile(join(directory, path), 'utf8'),

    // A file where the payload folder goes makes the folder impossible to create.
    blockPayloadFolder: () => writeFile(join(directory, 'payloads'), 'not a folder\n'),
  };
}

test('it keeps data under the cap in the envelope', async () => {
  const ctx = setupTest();

  const capped = await ctx.capData({ shelf: 'apples' });

  expect(capped).toStrictEqual({
    data: { shelf: 'apples' },
    evidence: [],
    truncatedPath: null,
    failure: null,
  });
});

test('it moves data over 32768 bytes to a payload file and keeps its path', async () => {
  const ctx = setupTest();
  const shelf = 'a'.repeat(40_000);

  const capped = await ctx.capData({ shelf });
  const written = await ctx.readFile(capped.truncatedPath ?? '');

  expect({ data: capped.data, written }).toStrictEqual({
    data: null,
    written: JSON.stringify({ shelf }),
  });
});

test('it carries a failure with no data or evidence when the payload file cannot be written', async () => {
  const ctx = setupTest();

  await ctx.blockPayloadFolder();

  const capped = await ctx.capData({ shelf: 'a'.repeat(40_000) });

  expect(capped).toStrictEqual({
    data: null,
    evidence: [],
    truncatedPath: null,
    failure: expect.objectContaining({ code: 'internal' }),
  });
});

test('it carries a failure when the data does not serialize', async () => {
  const ctx = setupTest();

  const capped = await ctx.capData({ count: 1n });

  expect(capped.failure).toMatchObject({ code: 'internal' });
});
