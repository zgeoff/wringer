import { expect, test } from 'bun:test';
import { collectFencedRanges } from './collect-fenced-ranges.ts';

test.each([
  ['a backtick fence', 'a\n```\nx\n```\nb\n', [{ start: 2, end: 12 }]],
  ['a tilde fence', 'a\n~~~\nx\n~~~\nb\n', [{ start: 2, end: 12 }]],
  ['a fence indented 3 spaces', '   ```\nx\n   ```\n', [{ start: 0, end: 16 }]],
  ['a CRLF fence', '```\r\nx\r\n```\r\ny', [{ start: 0, end: 13 }]],
  ['a fence that never closes', 'a\n```\nx\n', [{ start: 2, end: 8 }]],
  ['a fence closed by a longer one', '```\nx\n`````\n', [{ start: 0, end: 12 }]],
])('#collectFencedRanges finds %s', (_name, text, expected) => {
  expect(collectFencedRanges(text)).toStrictEqual(expected);
});

test.each([
  ['an indent of 4 spaces', '    ```\nx\n    ```\n'],
  ['a backtick fence whose info holds a backtick', '``` a`b\nx\n'],
  ['two backticks', '``\nx\n``\n'],
])('#collectFencedRanges finds no fence for %s', (_name, text) => {
  expect(collectFencedRanges(text)).toStrictEqual([]);
});

test('#collectFencedRanges keeps a fence open past a shorter closer and a different character', () => {
  expect(collectFencedRanges('````\n```\n~~~\n````\n')).toStrictEqual([{ start: 0, end: 18 }]);
});
