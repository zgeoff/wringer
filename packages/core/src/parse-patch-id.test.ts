import { expect, test } from 'bun:test';
import { emptyFingerprint, parsePatchID } from './parse-patch-id.ts';

test.each([
  { name: 'no output', stdout: '' },
  { name: 'only a line end', stdout: '\n' },
])('it returns the empty fingerprint for $name', (row) => {
  expect(parsePatchID(row.stdout)).toBe(emptyFingerprint);
});

test('it returns the patch ID from a line of patch ID and commit', () => {
  const stdout =
    'f1d2d2f924e986ac86fdf7b36c94bcdf32beec15 0000000000000000000000000000000000000000\n';

  expect(parsePatchID(stdout)).toBe('f1d2d2f924e986ac86fdf7b36c94bcdf32beec15');
});
