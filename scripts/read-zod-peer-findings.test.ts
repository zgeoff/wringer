import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { readZodPeerFindings } from './read-zod-peer-findings.ts';

test('it finds every published package in the repo taking zod as a catalog peer', () => {
  expect(readZodPeerFindings(join(import.meta.dir, '..'))).toStrictEqual([]);
});
