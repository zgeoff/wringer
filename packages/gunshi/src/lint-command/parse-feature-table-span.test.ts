import { expect, test } from 'bun:test';
import { parseFeatureTableSpan, toComparableTable } from './parse-feature-table-span.ts';

test('it returns the table between the markers and the line of the opening marker', () => {
  const text =
    'Intro\n\n<!-- wringer:features -->\n| a |\n| b |\n<!-- /wringer:features -->\nEnd\n';

  expect(parseFeatureTableSpan(text)).toStrictEqual({ ok: true, line: 3, table: '| a |\n| b |' });
});

test.each([
  ['the opening marker', 'no table here\n', 1],
  ['the closing marker', 'x\n<!-- wringer:features -->\n| a |\n', 2],
])('it fails a text that lacks %s', (_case, text, line) => {
  expect(parseFeatureTableSpan(text)).toStrictEqual({
    ok: false,
    line,
    reason: expect.stringContaining('marker'),
  });
});

test.each([
  [
    'a padded table to its unpadded form',
    '| Feature | Summary |\n| ------- | ------- |\n| a\\|b    | One     |',
    '|Feature|Summary|\n|---|---|\n|a\\|b|One|',
  ],
  [
    'a data cell of three dashes and keeps the dashes',
    '| Feature | Summary |\n| --- | --- |\n| a | --- |',
    '|Feature|Summary|\n|---|---|\n|a|---|',
  ],
  [
    'a data cell of one dash and keeps the dash',
    '| Feature | Summary |\n| --- | --- |\n| a | - |',
    '|Feature|Summary|\n|---|---|\n|a|-|',
  ],
])('#toComparableTable compacts %s', (_case, table, expected) => {
  expect(toComparableTable(table)).toStrictEqual(expected);
});
