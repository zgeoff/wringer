import { expect, test } from 'bun:test';
import { pickControlRefusal } from './pick-control-refusal.ts';

test.each([
  { case: 'a checkbox ticked', facts: { kind: 'checkbox', disabled: false }, checked: true },
  { case: 'a checkbox unticked', facts: { kind: 'checkbox', disabled: false }, checked: false },
  { case: 'a radio ticked', facts: { kind: 'radio', disabled: false }, checked: true },
] as const)('it accepts $case', (row) => {
  expect(pickControlRefusal(row.facts, row.checked)).toBeNull();
});

test.each([
  {
    case: 'a control that is neither',
    facts: { kind: 'other', disabled: false },
    checked: true,
    expected: 'The element is not a checkbox or a radio button.',
  },
  {
    case: 'a disabled checkbox',
    facts: { kind: 'checkbox', disabled: true },
    checked: true,
    expected: 'The control is disabled.',
  },
  {
    case: 'an uncheck of a radio',
    facts: { kind: 'radio', disabled: false },
    checked: false,
    expected: 'A radio button cannot be unchecked; check another radio of its group instead.',
  },
] as const)('it refuses $case', (row) => {
  expect(pickControlRefusal(row.facts, row.checked)).toBe(row.expected);
});
