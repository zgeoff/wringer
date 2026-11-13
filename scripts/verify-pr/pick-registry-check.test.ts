import { expect, test } from 'bun:test';
import { pickRegistryCheck } from './pick-registry-check.ts';

test('it passes a report from the expected registry', () => {
  const block = '<!-- wringer-data v2 {"version":2,"registry":"wringer","claims":[]} -->';

  expect(pickRegistryCheck(block, 'wringer')).toStrictEqual({
    ok: true,
    detail: 'the report is from wringer',
  });
});

test('it fails a report from another registry', () => {
  const block = '<!-- wringer-data v2 {"version":2,"registry":"shop","claims":[]} -->';

  expect(pickRegistryCheck(block, 'wringer')).toStrictEqual({
    ok: false,
    detail: 'the report is from shop; this CLI is wringer',
  });
});

test.each([
  ['no data comment', 'rows only'],
  ['a comment that is not JSON', '<!-- wringer-data v2 nope -->'],
  ['a comment with no registry', '<!-- wringer-data v2 {"version":2} -->'],
  ['a comment whose registry is no string', '<!-- wringer-data v2 {"registry":3} -->'],
  [
    'two comments',
    '<!-- wringer-data v2 {"registry":"wringer"} --><!-- wringer-data v2 {"registry":"wringer"} -->',
  ],
])('it fails a block with %s', (_name, block) => {
  expect(pickRegistryCheck(block, 'wringer').ok).toBe(false);
});
