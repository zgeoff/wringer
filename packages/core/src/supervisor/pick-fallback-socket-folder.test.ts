import { expect, test } from 'bun:test';
import { pickFallbackSocketFolder } from './pick-fallback-socket-folder.ts';

test.each([
  { name: 'a short folder', folder: '/var/tmp', platform: 'linux', expected: '/var/tmp' },
  {
    name: 'a folder whose socket path is exactly 100 bytes',
    folder: `/${'a'.repeat(79)}`,
    platform: 'linux',
    expected: `/${'a'.repeat(79)}`,
  },
  {
    name: 'a folder whose socket path is 101 bytes',
    folder: `/${'a'.repeat(80)}`,
    platform: 'linux',
    expected: '/tmp',
  },
  {
    name: 'a folder of multi-byte characters, short in characters and long in bytes',
    folder: `/${'é'.repeat(40)}`,
    platform: 'darwin',
    expected: '/tmp',
  },
  {
    name: 'a long Windows folder',
    folder: `C:\\${'long'.repeat(40)}`,
    platform: 'win32',
    expected: `C:\\${'long'.repeat(40)}`,
  },
] as const)('it picks the right folder for $name', (row) => {
  expect(pickFallbackSocketFolder(row.folder, row.platform)).toBe(row.expected);
});
