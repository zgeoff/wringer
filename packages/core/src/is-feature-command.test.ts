import { expect, test } from 'bun:test';
import { isFeatureCommand } from './is-feature-command.ts';

test.each([
  { feature: 'guide', path: ['guide'], expected: true },
  { feature: 'cli', path: ['guide'], expected: false },
  { feature: 'guide', path: ['guide', 'extra'], expected: false },
  { feature: null, path: ['guide'], expected: false },
  { feature: 'ghost', path: ['guide'], expected: false },
])('it answers $expected for $path under feature $feature', (row) => {
  const features = [
    { name: 'guide', summary: 'Print the guide', paths: ['guide/**'], commands: ['guide'] },
    { name: 'cli', summary: 'Parse the command line', paths: ['src/**'] },
  ];

  expect(isFeatureCommand(features, row.feature, row.path)).toBe(row.expected);
});
