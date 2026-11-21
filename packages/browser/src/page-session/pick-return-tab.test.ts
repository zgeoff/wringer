import { expect, test } from 'bun:test';
import { pickReturnTab } from './pick-return-tab.ts';

test.each([
  { case: 'the opener when it is open', openerIndex: 1, closedIndex: 2, remaining: 3, expected: 1 },
  {
    case: 'the tab before when there is no opener',
    openerIndex: null,
    closedIndex: 2,
    remaining: 3,
    expected: 1,
  },
  {
    case: 'the first tab when the first tab closed',
    openerIndex: null,
    closedIndex: 0,
    remaining: 2,
    expected: 0,
  },
  {
    case: 'the last tab when the closed index is past the end',
    openerIndex: null,
    closedIndex: 5,
    remaining: 2,
    expected: 1,
  },
  {
    case: 'nothing when no tab remains',
    openerIndex: null,
    closedIndex: 0,
    remaining: 0,
    expected: null,
  },
])('it returns to $case', (row) => {
  expect(pickReturnTab(row.openerIndex, row.closedIndex, row.remaining)).toBe(row.expected);
});
