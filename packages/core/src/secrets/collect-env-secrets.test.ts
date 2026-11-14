import { expect, test } from 'bun:test';
import { collectEnvSecrets } from './collect-env-secrets.ts';

test('it collects a declared name that has a value as a declared secret', () => {
  expect(
    collectEnvSecrets({
      declared: ['SHOP_API_TOKEN'],
      env: { SHOP_API_TOKEN: 'planted-shop-token' },
    }),
  ).toStrictEqual([
    { name: 'SHOP_API_TOKEN', value: 'planted-shop-token', origin: 'declared' },
    { name: 'SHOP_API_TOKEN', value: 'planted-shop-token', origin: 'collected' },
  ]);
});

test.each([{ env: {} }, { env: { SHOP_API_TOKEN: '' } }])(
  'it skips a declared name with no value in $env',
  (row) => {
    expect(collectEnvSecrets({ declared: ['SHOP_API_TOKEN'], env: row.env })).toStrictEqual([]);
  },
);

test.each([
  { key: 'GITHUB_TOKEN', value: 'planted-github-token', collected: true },
  { key: 'SSH_AUTH_SOCK', value: '/run/planted-agent-socket', collected: false },
  { key: 'SESSION_TIMEOUT', value: '3600', collected: false },
  { key: 'SESSION_TOKEN', value: '482913', collected: false },
  { key: 'SHOP_DB_URL_PASSWORD', value: 'postgres://shop@db.internal/shop', collected: false },
  { key: 'SHOP_DB_PASSWORD', value: 'user:planted-pass-word', collected: true },
])('it gives $collected for $key=$value', (row) => {
  const collected = collectEnvSecrets({ declared: [], env: { [row.key]: row.value } });

  expect(collected.length > 0).toBe(row.collected);
});

test('it collects the password of a URL value as well as the whole value', () => {
  const collected = collectEnvSecrets({
    declared: [],
    env: { SHOP_DB_SECRET_URL: 'postgres://shop:planted-pass-word@db.internal/shop' },
  });

  expect(collected.map((secret) => secret.value)).toStrictEqual([
    'postgres://shop:planted-pass-word@db.internal/shop',
    'planted-pass-word',
  ]);
});
