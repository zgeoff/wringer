import { expect, test } from 'bun:test';
import { createCoverWringer } from '../test-utils/create-cover-wringer.ts';
import { collectUnclaimedFiles } from './collect-unclaimed-files.ts';

test('it returns each file that no feature, shared or ignore glob matches', () => {
  const wringer = createCoverWringer({ shared: ['package.json'] });

  expect(
    collectUnclaimedFiles(wringer, ['src/cart.ts', 'package.json', 'verify/x.ts', 'notes.txt']),
  ).toStrictEqual(['notes.txt']);
});
