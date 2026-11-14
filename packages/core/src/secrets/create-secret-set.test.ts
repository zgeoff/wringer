import { expect, test } from 'bun:test';
import { createSecretSet, secretKeyPattern } from './create-secret-set.ts';

function setupTest(value = 'planted-shop-token') {
  const secrets = createSecretSet();

  secrets.add({ name: 'SHOP_API_TOKEN', value, origin: 'declared' });

  return { secrets, value };
}

test.each([
  { spelling: 'the value', build: (value: string) => value },
  {
    spelling: 'the value in a JSON string',
    build: (value: string) => JSON.stringify(value).slice(1, -1),
  },
  { spelling: 'a URL component', build: (value: string) => encodeURIComponent(value) },
  {
    spelling: 'a form-encoded value',
    build: (value: string) =>
      new URLSearchParams({ field: value }).toString().slice('field='.length),
  },
  {
    spelling: 'a base64 prefix',
    build: (value: string) =>
      Buffer.from(value)
        .toString('base64')
        .slice(0, Math.floor(Buffer.byteLength(value) / 3) * 4),
  },
  {
    spelling: 'a base64url prefix',
    build: (value: string) =>
      Buffer.from(value)
        .toString('base64url')
        .slice(0, Math.floor(Buffer.byteLength(value) / 3) * 4),
  },
])('#scrubText replaces $spelling', (row) => {
  const ctx = setupTest('planted shop+token "quoted" 100% !\'()~');
  const text = `before ${row.build(ctx.value)} after`;

  expect(ctx.secrets.scrubText(text)).toBe('before [redacted:SHOP_API_TOKEN] after');
});

test('#scrubText replaces the plus spelling of a value with spaces', () => {
  const ctx = setupTest('planted shop token');

  expect(ctx.secrets.scrubText('q=planted+shop+token&x=1')).toBe('q=[redacted:SHOP_API_TOKEN]&x=1');
});

test('#scrubText replaces a base64 prefix that has more bytes after it', () => {
  const ctx = setupTest();
  const encoded = Buffer.from(`${ctx.value}:more`).toString('base64');

  expect(ctx.secrets.scrubText(`Basic ${encoded}`)).toBe('Basic [redacted:SHOP_API_TOKEN]Om1vcmU=');
});

test('#scrubText lets the longer secret win an overlap', () => {
  const secrets = createSecretSet();

  secrets.add({ name: 'SHORT', value: 'shared-prefix', origin: 'declared' });
  secrets.add({ name: 'LONG', value: 'shared-prefix-and-more', origin: 'declared' });

  expect(secrets.scrubText('a shared-prefix-and-more b')).toBe('a [redacted:LONG] b');
});

test('#scrubText hides the edge of a shorter secret that overlaps a longer one', () => {
  const secrets = createSecretSet();

  secrets.add({ name: 'FIRST', value: 'abcdefgh', origin: 'declared' });
  secrets.add({ name: 'SECOND', value: 'efghijklm', origin: 'declared' });

  expect(secrets.scrubText('xabcdefghijklmx')).toBe('x[redacted:SECOND]x');
});

test('#scrubText gives the same text when applied twice', () => {
  const ctx = setupTest();
  const once = ctx.secrets.scrubText(`a ${ctx.value} b`);

  expect(ctx.secrets.scrubText(once)).toBe(once);
});

test('#scrubText replaces URL credentials with no known secret', () => {
  const ctx = setupTest();

  expect(ctx.secrets.scrubText('see https://admin:hunter2pass@db.internal:5432/shop')).toBe(
    'see https://[redacted:url-credentials]@db.internal:5432/shop',
  );
});

test('#scrubText leaves a URL with a port and no credentials alone', () => {
  const ctx = setupTest();

  expect(ctx.secrets.scrubText('http://127.0.0.1:4100/api')).toBe('http://127.0.0.1:4100/api');
});

test('#add throws a usage error for a declared value of 7 characters', () => {
  const secrets = createSecretSet();

  expect(() => {
    secrets.add({ name: 'SHOP_API_TOKEN', value: 'abcdefg', origin: 'declared' });
  }).toThrow('The secret SHOP_API_TOKEN is shorter than 8 characters.');
});

test('#add answers a short declared value with the usage code', () => {
  const secrets = createSecretSet();

  expect(() => {
    secrets.add({ name: 'SHOP_API_TOKEN', value: 'abcdefg', origin: 'declared' });
  }).toThrow(expect.objectContaining({ code: 'usage' }));
});

test.each([
  { text: 'session 482913 ready', expected: 'session [redacted:SESSION_TOKEN] ready' },
  { text: 'session=482913;', expected: 'session=[redacted:SESSION_TOKEN];' },
  { text: 'order 9482913 placed', expected: 'order 9482913 placed' },
  { text: 'order 4829130 placed', expected: 'order 4829130 placed' },
  { text: 'id_482913x', expected: 'id_482913x' },
])('#scrubText matches a 6-digit collected value as a whole token in $text', (row) => {
  const secrets = createSecretSet();

  secrets.add({ name: 'SESSION_TOKEN', value: '482913', origin: 'collected' });

  expect(secrets.scrubText(row.text)).toBe(row.expected);
});

test('#scrubText treats an underscore as the edge of a short token', () => {
  const secrets = createSecretSet();

  secrets.add({ name: 'SESSION_TOKEN', value: '482913', origin: 'collected' });

  expect(secrets.scrubText('id_482913_x')).toBe('id_[redacted:SESSION_TOKEN]_x');
});

test.each(['', 'abc', '123'])('#add skips the collected value %j', (value) => {
  const secrets = createSecretSet();

  secrets.add({ name: 'SHORT', value, origin: 'collected' });

  expect(secrets.scrubText(`a ${value} b`)).toBe(`a ${value} b`);
});

test('#scrubValue scrubs every string and key at any depth', () => {
  const ctx = setupTest();

  const scrubbed = ctx.secrets.scrubValue({
    [`k-${ctx.value}`]: [{ note: `a ${ctx.value}` }, 7, null],
  });

  expect(scrubbed).toStrictEqual({
    'k-[redacted:SHOP_API_TOKEN]': [{ note: 'a [redacted:SHOP_API_TOKEN]' }, 7, null],
  });
});

test('#scrubValue keeps both values when two scrubbed keys collide', () => {
  const secrets = createSecretSet();

  secrets.add({ name: 'A', value: 'aaaaaaaa', origin: 'declared' });
  secrets.add({ name: 'B', value: 'bbbbbbbb', origin: 'declared' });

  const scrubbed = secrets.scrubValue({ 'x-aaaaaaaa': 1, 'x-[redacted:A]': 2 });

  expect(scrubbed).toStrictEqual({ 'x-[redacted:A]': 1, 'x-[redacted:A]#2': 2 });
});

test('#findSecret names the first secret found in any spelling', () => {
  const ctx = setupTest();

  expect(ctx.secrets.findSecret(`q=${encodeURIComponent(ctx.value)}`)).toBe('SHOP_API_TOKEN');
});

test('#findSecret returns null for a clean text', () => {
  const ctx = setupTest();

  expect(ctx.secrets.findSecret('nothing here')).toBeNull();
});

test('#findSecret counts only the origin it is asked for', () => {
  const secrets = createSecretSet();

  secrets.add({ name: 'SESSION_TOKEN', value: 'collected-value', origin: 'collected' });

  expect(secrets.findSecret('a collected-value b', 'declared')).toBeNull();
});

test.each([
  { key: 'GITHUB_TOKEN', expected: true },
  { key: 'SHOP_DB_PASSWORD', expected: true },
  { key: 'STRIPE_API_KEY', expected: true },
  { key: 'SESSION_SECRET', expected: true },
  { key: 'SSH_AUTH_SOCK', expected: false },
  { key: 'SESSION_TIMEOUT', expected: false },
])('#secretKeyPattern gives $expected for $key', (row) => {
  expect(secretKeyPattern.test(row.key)).toBe(row.expected);
});

test('#scrubValue reads a URL and an error with fields as JSON does', () => {
  const ctx = setupTest();

  class ShelfError extends Error {
    override name = 'ShelfError';

    readonly said = `paid with ${ctx.value}`;
  }

  const scrubbed = ctx.secrets.scrubValue({
    link: new URL(`https://shop.example/?key=${ctx.value}`),
    failure: new ShelfError('out of stock'),
  });

  expect(scrubbed).toStrictEqual({
    link: 'https://shop.example/?key=[redacted:SHOP_API_TOKEN]',
    failure: { name: 'ShelfError', said: 'paid with [redacted:SHOP_API_TOKEN]' },
  });
});

test('#scrubValue leaves a bigint and a circular object for the serializer to refuse', () => {
  const ctx = setupTest();
  const circular: Record<string, unknown> = { count: 3n };

  circular['self'] = circular;

  const scrubbed = ctx.secrets.scrubValue(circular);

  expect(scrubbed).toStrictEqual({ count: 3n, self: circular });
});
