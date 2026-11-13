import { expect, test } from 'bun:test';
import { pickContentType } from './pick-content-type.ts';

test.each([
  ['page.png', 'opaque', 'image/png'],
  ['page.JPG', 'opaque', 'image/jpeg'],
  ['page.jpeg', 'opaque', 'image/jpeg'],
  ['page.gif', 'opaque', 'image/gif'],
  ['page.webp', 'opaque', 'image/webp'],
  ['clip.mp4', 'opaque', 'video/mp4'],
  ['clip.webm', 'opaque', 'video/webm'],
  ['page.html', 'text', 'text/plain'],
  ['logo.svg', 'text', 'text/plain'],
  ['notes.md', 'text', 'text/plain'],
  ['feed.xml', 'text', 'text/plain'],
  ['trace.zip', 'opaque', 'application/octet-stream'],
  ['session.har', 'opaque', 'application/octet-stream'],
  ['page.html', 'opaque', 'application/octet-stream'],
] as const)('it picks the content type of %s scrubbed as %s as %s', (path, scrub, expected) => {
  expect(pickContentType({ kind: 'note', path, sha256: 'a'.repeat(64), scrub })).toBe(expected);
});

test('it reads a file with no recorded scrub as opaque', () => {
  expect(pickContentType({ kind: 'note', path: 'a.txt', sha256: 'a'.repeat(64) })).toBe(
    'application/octet-stream',
  );
});
