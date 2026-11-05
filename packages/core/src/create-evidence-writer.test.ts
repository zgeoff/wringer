import { expect, onTestFinished, test } from 'bun:test';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { buildStubClock } from '../test-utils/build-stub-clock.ts';
import { createEvidenceWriter } from './create-evidence-writer.ts';
import { createNodeRepoHost } from './create-node-repo-host.ts';

async function setupTest() {
  const root = await createTestFolder(import.meta.dir, 'evidence-writer');

  onTestFinished(() => rm(root, { recursive: true, force: true }));

  const clock = buildStubClock();

  const evidence = createEvidenceWriter({
    root,
    directory: join(root, '.wringer', 'evidence'),
    now: clock.now,
    files: createNodeRepoHost(),
  });

  return {
    root,
    clock,
    evidence,
    readText: (path: string) => readFile(join(root, path), 'utf8'),
  };
}

test('it writes a file under a stamped name, relative to the root', async () => {
  const ctx = await setupTest();

  ctx.clock.set('2026-03-01T09:30:00.000Z');

  const evidence = await ctx.evidence.writer.writeFile('http', 'get.json', '{"ok":true}');

  expect(evidence).toStrictEqual({
    kind: 'http',
    path: '.wringer/evidence/2026-03-01T09-30-00-000Z-get.json',
    sha256: new Bun.CryptoHasher('sha256').update('{"ok":true}').digest('hex'),
  });
});

test('it records a file that already exists and adds it to the collected list', async () => {
  const ctx = await setupTest();

  await writeFile(join(ctx.root, 'receipt.png'), 'receipt bytes');

  const evidence = await ctx.evidence.writer.addFile('screenshot', join(ctx.root, 'receipt.png'));

  const expected = {
    kind: 'screenshot',
    path: 'receipt.png',
    sha256: new Bun.CryptoHasher('sha256').update('receipt bytes').digest('hex'),
  };

  expect({ evidence, collected: ctx.evidence.collected }).toStrictEqual({
    evidence: expected,
    collected: [expected],
  });
});

test('it keeps both files when two writes in one millisecond share a name', async () => {
  const ctx = await setupTest();

  ctx.clock.set('2026-03-01T09:30:00.000Z');

  const written = await Promise.all([
    ctx.evidence.writer.writeFile('http', 'get.json', 'first'),
    ctx.evidence.writer.writeFile('http', 'get.json', 'second'),
  ]);

  const contents = await Promise.all(written.map((evidence) => ctx.readText(evidence.path)));

  expect(contents.toSorted()).toStrictEqual(['first', 'second']);
});
