import { expect, test } from 'bun:test';
import { parseShellWords } from './parse-shell-words.ts';

test.each([
  ['plain words', 'bun verify up', ['bun', 'verify', 'up']],
  ['runs of spaces', '  bun   verify  up ', ['bun', 'verify', 'up']],
  [
    'single quotes',
    `bun verify use --label 'two words'`,
    ['bun', 'verify', 'use', '--label', 'two words'],
  ],
  [
    'double quotes',
    String.raw`bun verify use --label "say \"hi\""`,
    ['bun', 'verify', 'use', '--label', 'say "hi"'],
  ],
  ['an empty quoted word', `bun verify use --label ''`, ['bun', 'verify', 'use', '--label', '']],
  [
    'a backslash outside quotes',
    String.raw`bun verify use --label two\ words`,
    ['bun', 'verify', 'use', '--label', 'two words'],
  ],
  [
    'a quoted word joined to text',
    `--address='{"town":"Hollin"}'`,
    ['--address={"town":"Hollin"}'],
  ],
  ['a pipe', 'bun verify status | jq .data', ['bun', 'verify', 'status']],
  ['a redirect', 'bun verify report --human > body.md', ['bun', 'verify', 'report', '--human']],
  ['an and-list', 'bun verify up && bun verify doctor', ['bun', 'verify', 'up']],
  ['a comment', 'bun verify up # start the app', ['bun', 'verify', 'up']],
  [
    'a hash inside a word',
    'bun verify use --label a#b',
    ['bun', 'verify', 'use', '--label', 'a#b'],
  ],
  ['a quoted pipe', `bun verify use --label 'a | b'`, ['bun', 'verify', 'use', '--label', 'a | b']],
])('it splits a line with %s into its words', (_case, line, words) => {
  expect(parseShellWords(line)).toStrictEqual(words);
});

test.each([
  ['a single quote', `bun verify use --label 'open`],
  ['a double quote', 'bun verify use --label "open'],
])('it returns null for a line with an unclosed %s', (_case, line) => {
  expect(parseShellWords(line)).toBeNull();
});
