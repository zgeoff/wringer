import { expect, test } from 'bun:test';
import { parseSecretsFile } from './parse-secrets-file.ts';

test('it reads a record with no origin as a collected secret', () => {
  expect(parseSecretsFile('{"name":"notes.session","value":"planted-old-value"}\n')).toStrictEqual([
    { name: 'notes.session', value: 'planted-old-value', origin: 'collected' },
  ]);
});

test('it keeps the origin a record stores', () => {
  expect(
    parseSecretsFile(
      '{"name":"SHOP_API_TOKEN","value":"planted-token-value","origin":"declared"}\n',
    ),
  ).toStrictEqual([{ name: 'SHOP_API_TOKEN', value: 'planted-token-value', origin: 'declared' }]);
});
