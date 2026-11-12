import { expect, test } from 'bun:test';
import { isGlobMatch } from './is-glob-match.ts';

test.each([
  ['README.md', ['**/*.md'], true],
  ['docs/guide/start.md', ['**/*.md'], true],
  ['.github/workflows/ci.yml', ['.github/**'], true],
  ['src/pay.ts', ['docs/**', '**/*.md'], false],
  ['src/pay.ts', [], false],
])('it matches %s against %j: %p', (path, globs, expected) => {
  expect(isGlobMatch(path, globs)).toBe(expected);
});
