import { expect, test } from 'bun:test';
import { splitDiffByPath } from './split-diff-by-path.ts';

test('it gives each path its chunk in order', () => {
  const diff = Buffer.from(
    `diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n+one\ndiff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ b/b.ts\n+two\n`,
  );

  const chunks = splitDiffByPath(diff, [
    { status: 'M', path: Buffer.from('a.ts') },
    { status: 'A', path: Buffer.from('b.ts') },
  ]);

  expect(chunks.map((chunk) => [chunk.path.toString(), chunk.bytes.toString()])).toStrictEqual([
    ['a.ts', `diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n+one\n`],
    ['b.ts', `diff --git a/b.ts b/b.ts\n--- a/b.ts\n+++ b/b.ts\n+two\n`],
  ]);
});

test('it gives a type change two chunks', () => {
  const diff = Buffer.from(
    `diff --git a/link b/link\n--- a/link\n+++ b/link\n-old\ndiff --git a/link b/link\n--- a/link\n+++ b/link\n+new\n`,
  );

  const chunks = splitDiffByPath(diff, [{ status: 'T', path: Buffer.from('link') }]);

  expect(chunks.map((chunk) => chunk.path.toString())).toStrictEqual(['link', 'link']);
});

test('it keeps a name with a space, a quote and a newline from the names it was given', () => {
  const diff = Buffer.from(
    'diff --git "a/a \\"b\\"\\nc" "b/a \\"b\\"\\nc"\n--- /dev/null\n+++ "b/a \\"b\\"\\nc"\n+x\n',
  );

  const chunks = splitDiffByPath(diff, [{ status: 'A', path: Buffer.from('a "b"\nc') }]);

  expect(chunks.map((chunk) => chunk.path.toString())).toStrictEqual(['a "b"\nc']);
});

test('it does not split at a header-like line inside a chunk', () => {
  const diff = Buffer.from(
    `diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n+diff --git a/x b/x\n`,
  );

  const chunks = splitDiffByPath(diff, [{ status: 'M', path: Buffer.from('a.ts') }]);

  expect(chunks).toHaveLength(1);
});

test('it throws internal when the chunk count does not match the names', () => {
  const diff = Buffer.from('diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n');

  expect(() => splitDiffByPath(diff, [])).toThrow(/expected/u);
});
