import { expect, test } from 'bun:test';
import { findLocatorProblem } from './find-locator-problem.ts';

test.each([
  { case: 'a ref', args: { ref: 'e5' } },
  { case: 'a role and a name', args: { role: 'button', name: 'Search' } },
  { case: 'a role alone', args: { role: 'button' } },
  { case: 'a label', args: { label: 'Email' } },
  { case: 'a label and a role', args: { label: 'Email', role: 'textbox' } },
])('it accepts $case', (row) => {
  expect(findLocatorProblem(row.args, true)).toBeNull();
});

test.each([
  {
    case: 'a ref and a role',
    args: { ref: 'e5', role: 'button' },
    expected: 'Pass --ref alone, with no other locator flag.',
  },
  {
    case: 'a ref and a label',
    args: { ref: 'e5', label: 'Email' },
    expected: 'Pass --ref alone, with no other locator flag.',
  },
  {
    case: 'a label and a name',
    args: { label: 'Email', name: 'Email' },
    expected: 'Pass --label with --role at most, never with --name.',
  },
  { case: 'a name alone', args: { name: 'Email' }, expected: 'Pass --name together with --role.' },
  { case: 'no flag', args: {}, expected: 'Pass --ref, --role with --name, or --label.' },
])('it refuses $case when an element is required', (row) => {
  expect(findLocatorProblem(row.args, true)).toBe(row.expected);
});

test('it accepts no flag when the element is optional', () => {
  expect(findLocatorProblem({}, false)).toBeNull();
});
