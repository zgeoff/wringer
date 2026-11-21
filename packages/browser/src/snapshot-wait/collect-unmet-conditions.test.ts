import { expect, test } from 'bun:test';
import { collectUnmetConditions } from './collect-unmet-conditions.ts';

test.each<{
  name: string;
  text: string;
  conditions: { untilText?: string; untilNoText?: string };
  unmet: string[];
}>([
  { name: 'holds the text', text: 'button "Save"', conditions: { untilText: 'Save' }, unmet: [] },
  {
    name: 'differs in case from the text',
    text: 'button "Save"',
    conditions: { untilText: 'save' },
    unmet: ['never showed the text "save"'],
  },
  {
    name: 'lacks the unwanted text',
    text: 'heading "Done"',
    conditions: { untilNoText: 'Loading' },
    unmet: [],
  },
  {
    name: 'holds the unwanted text',
    text: 'status "Loading"',
    conditions: { untilNoText: 'Loading' },
    unmet: ['still shows the text "Loading"'],
  },
  {
    name: 'holds the text and lacks the unwanted one',
    text: 'heading "Done"',
    conditions: { untilText: 'Done', untilNoText: 'Loading' },
    unmet: [],
  },
  {
    name: 'fails both conditions',
    text: 'status "Loading"',
    conditions: { untilText: 'Done', untilNoText: 'Loading' },
    unmet: ['never showed the text "Done"', 'still shows the text "Loading"'],
  },
])('#collectUnmetConditions returns $unmet when the snapshot $name', (row) => {
  expect(collectUnmetConditions(row.text, row.conditions)).toStrictEqual(row.unmet);
});
