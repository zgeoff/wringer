import { expect, test } from 'bun:test';
import { buildWalkKey } from './build-walk-key.ts';
import type { WalkKeyInput } from './build-walk-key.ts';

function setupTest() {
  const same: WalkKeyInput = {
    head: 'abc',
    status: 's1',
    entries: [['core', ['a.ts']]],
    changed: [['a.ts', 'h1']],
  };

  return { same };
}

test('it gives one key to the same commit, entries and changed files', () => {
  const ctx = setupTest();

  expect(buildWalkKey(ctx.same)).toBe(buildWalkKey({ ...ctx.same }));
});

test.each([
  { name: 'commit', other: { head: 'def' } },
  { name: 'status', other: { status: 's2' } },
  { name: 'entries', other: { entries: [['core', ['b.ts']]] } },
  { name: 'changed file content', other: { changed: [['a.ts', 'h2']] } },
  { name: 'changed file removed', other: { changed: [['a.ts', null]] } },
] as const)('it gives another key when the $name differs', (row) => {
  const ctx = setupTest();

  expect(buildWalkKey({ ...ctx.same, ...row.other })).not.toBe(buildWalkKey(ctx.same));
});
