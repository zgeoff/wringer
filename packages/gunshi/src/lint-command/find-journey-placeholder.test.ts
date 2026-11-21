import { expect, test } from 'bun:test';
import { findJourneyPlaceholder } from './find-journey-placeholder.ts';

test.each([
  ['a placeholder value', 'bun verify use --feature <name>', '<name>'],
  ['a placeholder positional', 'bun verify guide <topic>', '<topic>'],
  [
    'the first of two placeholders',
    'bun verify http request --path <path> --method <verb>',
    '<path>',
  ],
])('it returns %s', (_case, text, expected) => {
  expect(findJourneyPlaceholder(text)).toBe(expected);
});

test.each([
  ['a line with no placeholder', 'bun verify action greet --name Wren'],
  ['a placeholder in single quotes', "bun verify action greet --name '<name>'"],
  ['a placeholder in double quotes', 'bun verify action greet --name "<name>"'],
  ['a file redirect', 'bun verify report --human > body.md'],
  ['an input redirect from a file', 'bun verify gate --body-file x <body.md'],
])('it returns null for %s', (_case, text) => {
  expect(findJourneyPlaceholder(text)).toBeNull();
});
