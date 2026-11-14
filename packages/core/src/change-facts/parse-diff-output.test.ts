import { expect, test } from 'bun:test';
import { parseDiffOutput } from './parse-diff-output.ts';

test('it splits the raw entries from the patch', () => {
  const output = Buffer.from(
    `:100644 100644 1111111 2222222 M\0a.ts\0:000000 100644 0000000 2222222 A\0b c.ts\0\0diff --git a/a.ts b/a.ts\n+one\n`,
  );

  const result = parseDiffOutput(output);

  expect({
    entries: result.entries.map((entry) => [entry.status, entry.path.toString()]),
    patch: result.patch.toString(),
  }).toStrictEqual({
    entries: [
      ['M', 'a.ts'],
      ['A', 'b c.ts'],
    ],
    patch: 'diff --git a/a.ts b/a.ts\n+one\n',
  });
});

test('it gives no entries and no patch for an empty output', () => {
  const result = parseDiffOutput(Buffer.alloc(0));

  expect({ entries: result.entries, patch: result.patch.toString() }).toStrictEqual({
    entries: [],
    patch: '',
  });
});

test('it keeps a path that starts with a colon out of the patch', () => {
  const output = Buffer.from(
    `:100644 100644 1111111 2222222 M\0:odd.ts\0\0diff --git a/:odd.ts b/:odd.ts\n`,
  );

  const result = parseDiffOutput(output);

  expect(result.entries.map((entry) => entry.path.toString())).toStrictEqual([':odd.ts']);
});
