import { expect, test } from 'bun:test';
import { collectUnclaimedFiles } from './collect-unclaimed-files.ts';
import { createCoverWringer } from './test-utils/create-cover-wringer.ts';

test('it returns each file that no feature, shared or ignore glob matches', () => {
  const wringer = createCoverWringer({ shared: ['package.json'] });

  expect(
    collectUnclaimedFiles(wringer, ['src/cart.ts', 'package.json', 'verify/x.ts', 'notes.txt']),
  ).toStrictEqual(['notes.txt']);
});
