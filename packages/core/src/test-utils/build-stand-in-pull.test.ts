import { expect, test } from 'bun:test';
import { buildStandInPull } from './build-stand-in-pull.ts';

test('it overrides a field and keeps the rest', () => {
  expect(buildStandInPull({ number: 9 })).toStrictEqual({
    number: 9,
    head: 'feature',
    state: 'open',
    body: 'Hello',
    base: 'main',
  });
});
