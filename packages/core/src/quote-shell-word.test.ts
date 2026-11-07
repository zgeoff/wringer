import { expect, test } from 'bun:test';
import { quoteShellWord } from './quote-shell-word.ts';

test.each([
  ['psql', 'psql'],
  ['--user=app_ro', '--user=app_ro'],
  ['', "''"],
  ['two words', "'two words'"],
  ["it's", `'it'\\''s'`],
  ['$HOME;rm', "'$HOME;rm'"],
])('it quotes %p as %p', (word, quoted) => {
  expect(quoteShellWord(word)).toBe(quoted);
});
