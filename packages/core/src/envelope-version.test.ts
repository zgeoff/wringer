import { expect, test } from 'bun:test';
import { envelopeVersion } from './index.ts';

test('it exports envelope version 1 from the package entry', () => {
  expect(envelopeVersion).toBe(1);
});
