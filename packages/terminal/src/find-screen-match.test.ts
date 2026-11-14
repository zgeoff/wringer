import { expect, test } from 'bun:test';
import { findScreenMatch } from './find-screen-match.ts';

function setupTest() {
  return { text: 'Orders\n\n 1  Teapot\n 2  Mug' };
}

test('#findScreenMatch gives the row and column of the first text match', () => {
  const ctx = setupTest();

  expect(findScreenMatch(ctx.text, { kind: 'text', text: 'Mug' })).toStrictEqual({
    row: 3,
    col: 4,
  });
});

test('#findScreenMatch gives the row and column of the first regex match', () => {
  const ctx = setupTest();

  expect(findScreenMatch(ctx.text, { kind: 'regex', source: String.raw`\d  T` })).toStrictEqual({
    row: 2,
    col: 1,
  });
});

test('#findScreenMatch returns null when nothing matches', () => {
  const ctx = setupTest();

  expect(findScreenMatch(ctx.text, { kind: 'text', text: 'Kettle' })).toBeNull();
});
