import { expect, test } from 'bun:test';
import { pickCommandEffect } from './pick-command-effect.ts';

test.each([
  {
    case: 'a role and the granted name',
    args: { role: 'button', name: 'Search' },
    expected: 'read',
  },
  { case: 'a role and another name', args: { role: 'button', name: 'Buy' }, expected: 'write' },
  { case: 'a ref', args: { ref: 'e5' }, expected: 'write' },
  { case: 'a label with no role', args: { label: 'Search' }, expected: 'write' },
  { case: 'a text with no role', args: { text: 'Search' }, expected: 'write' },
  {
    case: 'a text and the granted role',
    args: { text: 'Search', role: 'button' },
    expected: 'read',
  },
  { case: 'a text and another role', args: { text: 'Search', role: 'link' }, expected: 'write' },
  {
    case: 'a label and the granted role',
    args: { label: 'Search', role: 'button' },
    expected: 'read',
  },
])('it picks $expected for $case', (row) => {
  expect(pickCommandEffect(row.args, [{ role: 'button', name: 'Search' }])).toBe(row.expected);
});
