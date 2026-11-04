import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createEvidenceWriter } from './create-evidence-writer.ts';

async function setupTest() {
  const root = await mkdtemp(join(import.meta.dir, '.test-evidence-writer-'));

  onTestFinished(() => rm(root, { recursive: true, force: true }));

  const evidence = createEvidenceWriter({
    root,
    directory: join(root, '.wringer', 'evidence'),
    now: () => new Date('2026-03-01T09:30:00.000Z'),
  });

  return {
    root,
    evidence,
    readText: (path: string) => readFile(join(root, path), 'utf8'),
  };
}

test('it writes a file under a stamped name, relative to the root', async () => {
  const ctx = await setupTest();
  const evidence = await ctx.evidence.writer.writeFile('http', 'get.json', '{"ok":true}');

  expect(evidence).toStrictEqual({
    kind: 'http',
    path: '.wringer/evidence/2026-03-01T09-30-00-000Z-get.json',
    sha256: new Bun.CryptoHasher('sha256').update('{"ok":true}').digest('hex'),
  });
});

test('it keeps both files when two writes in one millisecond share a name', async () => {
  const ctx = await setupTest();

  const written = await Promise.all([
    ctx.evidence.writer.writeFile('http', 'get.json', 'first'),
    ctx.evidence.writer.writeFile('http', 'get.json', 'second'),
  ]);

  const contents = await Promise.all(written.map((evidence) => ctx.readText(evidence.path)));

  expect(contents.toSorted()).toStrictEqual(['first', 'second']);
});
