import { expect, test } from 'bun:test';
import { reverseDiffFiles } from './reverse-diff-files.ts';

test('it lists the files of a diff in the opposite order', () => {
  const diff = Buffer.from(
    'diff --git a/apples.txt b/apples.txt\n-red\n+yellow\ndiff --git a/pears.txt b/pears.txt\n-green\n+brown\n',
  );

  const reversed = Buffer.from(reverseDiffFiles(diff)).toString();

  expect(reversed).toBe(
    'diff --git a/pears.txt b/pears.txt\n-green\n+brown\ndiff --git a/apples.txt b/apples.txt\n-red\n+yellow\n',
  );
});

test('it keeps the bytes of a line that is not UTF-8', () => {
  const diff = Buffer.concat([
    Buffer.from('diff --git a/menu.txt b/menu.txt\n+caf'),
    Buffer.from([0xe9, 0x0a]),
  ]);

  expect(Buffer.from(reverseDiffFiles(diff))).toStrictEqual(diff);
});
