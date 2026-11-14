import { expect, test } from 'bun:test';
import { buildRedactedExchange } from './build-redacted-exchange.ts';
import type { HttpExchange } from './build-redacted-exchange.ts';
import { buildRedaction } from './build-redaction.ts';

interface ExchangeParts {
  readonly requestHeaders?: Record<string, string>;
  readonly responseHeaders?: Record<string, string>;
  readonly path?: string;
  readonly requestJSON?: unknown;
  readonly responseJSON?: unknown;
}

interface RedactionParts {
  readonly headers?: readonly string[];
  readonly query?: readonly string[];
  readonly bodyPaths?: readonly string[];
}

function setupTest() {
  return {
    buildRedaction: (parts: RedactionParts) =>
      buildRedaction({
        headers: parts.headers ?? [],
        query: parts.query ?? [],
        bodyPaths: parts.bodyPaths ?? [],
      }),
    buildExchange: (parts: ExchangeParts): HttpExchange => {
      const path = parts.path ?? '/api/orders';

      return {
        request: {
          method: 'POST',
          path,
          headers: parts.requestHeaders ?? {},
          json: parts.requestJSON,
          url: `http://127.0.0.1:4100${path}`,
        },
        response: {
          status: 201,
          headers: parts.responseHeaders ?? {},
          body: JSON.stringify(parts.responseJSON ?? null),
          json: parts.responseJSON ?? null,
        },
      };
    },
  };
}

test.each([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'x-shop-token',
  'x-user-session',
  'x-db-password',
  'x-shop-secret',
  'x-apikey',
])('it redacts the %s header in the request and the response', (name) => {
  const ctx = setupTest();

  const result = buildRedactedExchange(
    ctx.buildExchange({
      requestHeaders: { [name]: 'planted-header-value' },
      responseHeaders: { [name]: 'planted-header-value' },
    }),
    ctx.buildRedaction({}),
  );

  expect({
    request: result.request.headers,
    response: result.response.headers,
    secrets: result.secrets,
  }).toStrictEqual({
    request: { [name]: `[redacted:http.header.${name}]` },
    response: { [name]: `[redacted:http.header.${name}]` },
    secrets: [
      { name: `http.header.${name}`, value: 'planted-header-value' },
      { name: `http.header.${name}`, value: 'planted-header-value' },
    ],
  });
});

test('it redacts a configured header in any letter case', () => {
  const ctx = setupTest();

  const result = buildRedactedExchange(
    ctx.buildExchange({ requestHeaders: { 'X-Shop-Trace': 'planted-trace-value' } }),
    ctx.buildRedaction({ headers: ['x-SHOP-trace'] }),
  );

  expect(result.request.headers).toStrictEqual({
    'X-Shop-Trace': '[redacted:http.header.x-shop-trace]',
  });
});

test('it keeps a header that no rule names', () => {
  const ctx = setupTest();

  const result = buildRedactedExchange(
    ctx.buildExchange({ requestHeaders: { accept: 'application/json' } }),
    ctx.buildRedaction({}),
  );

  expect({ headers: result.request.headers, secrets: result.secrets }).toStrictEqual({
    headers: { accept: 'application/json' },
    secrets: [],
  });
});

test('it adds the token after an auth scheme beside the whole header value', () => {
  const ctx = setupTest();

  const result = buildRedactedExchange(
    ctx.buildExchange({ requestHeaders: { authorization: 'Bearer planted-bearer-token' } }),
    ctx.buildRedaction({}),
  );

  expect(result.secrets).toStrictEqual([
    { name: 'http.header.authorization', value: 'Bearer planted-bearer-token' },
    { name: 'http.header.authorization', value: 'planted-bearer-token' },
  ]);
});

test('it keeps each cookie name and drops its value in the cookie header', () => {
  const ctx = setupTest();

  const result = buildRedactedExchange(
    ctx.buildExchange({
      requestHeaders: { cookie: 'sid=planted-sid-value; theme=planted-dark-theme' },
    }),
    ctx.buildRedaction({}),
  );

  expect({ headers: result.request.headers, secrets: result.secrets }).toStrictEqual({
    headers: { cookie: 'sid=[redacted:http.cookie.sid]; theme=[redacted:http.cookie.theme]' },
    secrets: [
      { name: 'http.cookie.sid', value: 'planted-sid-value' },
      { name: 'http.cookie.theme', value: 'planted-dark-theme' },
    ],
  });
});

test('it collects a quoted cookie value in both its forms, in the request and the response', () => {
  const ctx = setupTest();

  const result = buildRedactedExchange(
    ctx.buildExchange({
      requestHeaders: { cookie: 'sid="planted-sid-value"' },
      responseHeaders: { 'set-cookie': 'cart="planted-cart-value"; Path=/' },
    }),
    ctx.buildRedaction({}),
  );

  expect(result.secrets).toStrictEqual([
    { name: 'http.cookie.sid', value: '"planted-sid-value"' },
    { name: 'http.cookie.sid', value: 'planted-sid-value' },
    { name: 'http.cookie.cart', value: '"planted-cart-value"' },
    { name: 'http.cookie.cart', value: 'planted-cart-value' },
  ]);
});

test.each([
  {
    name: 'one cookie with attributes',
    value: 'sid=planted-sid-value; Path=/; HttpOnly',
    redacted: 'sid=[redacted:http.cookie.sid]; Path=/; HttpOnly',
  },
  {
    name: 'two cookies joined in one value',
    value: 'sid=planted-sid-value, cart=planted-cart-value; Path=/',
    redacted: 'sid=[redacted:http.cookie.sid], cart=[redacted:http.cookie.cart]; Path=/',
  },
  {
    name: 'an expires attribute with a comma',
    value: 'sid=planted-sid-value; Expires=Wed, 21 Oct 2026 07:28:00 GMT',
    redacted: 'sid=[redacted:http.cookie.sid]; Expires=Wed, 21 Oct 2026 07:28:00 GMT',
  },
])('it redacts the set-cookie value of $name', (row) => {
  const ctx = setupTest();

  const result = buildRedactedExchange(
    ctx.buildExchange({ responseHeaders: { 'set-cookie': row.value } }),
    ctx.buildRedaction({}),
  );

  expect(result.response.headers).toStrictEqual({ 'set-cookie': row.redacted });
});

test.each([
  'token',
  'access_token',
  'id_token',
  'api_key',
  'apikey',
  'key',
  'secret',
  'password',
  'sig',
  'code',
])('it redacts the default query parameter %s in the path and the URL', (name) => {
  const ctx = setupTest();

  const result = buildRedactedExchange(
    ctx.buildExchange({ path: `/api/orders?page=2&${name}=planted-query-value` }),
    ctx.buildRedaction({}),
  );

  expect({
    path: result.request.path,
    url: result.request.url,
    secrets: result.secrets.map((secret) => secret.value),
  }).toStrictEqual({
    path: `/api/orders?page=2&${name}=[redacted:http.query.${name}]`,
    url: `http://127.0.0.1:4100/api/orders?page=2&${name}=[redacted:http.query.${name}]`,
    secrets: ['planted-query-value', 'planted-query-value'],
  });
});

test('it redacts a configured query parameter and keeps the others', () => {
  const ctx = setupTest();

  const result = buildRedactedExchange(
    ctx.buildExchange({ path: '/api/orders?Signature=planted-sig-value&page=2#top' }),
    ctx.buildRedaction({ query: ['signature'] }),
  );

  expect(result.request.path).toBe(
    '/api/orders?Signature=[redacted:http.query.signature]&page=2#top',
  );
});

test('it adds the decoded and the raw value of an encoded query parameter', () => {
  const ctx = setupTest();

  const result = buildRedactedExchange(
    ctx.buildExchange({ path: '/api/orders?token=planted%20query+value' }),
    ctx.buildRedaction({}),
  );

  expect(result.secrets.map((secret) => secret.value)).toStrictEqual([
    'planted query value',
    'planted%20query+value',
    'planted query value',
    'planted%20query+value',
  ]);
});

test('it redacts the query of a location header', () => {
  const ctx = setupTest();

  const result = buildRedactedExchange(
    ctx.buildExchange({ responseHeaders: { location: '/callback?code=planted-code-value' } }),
    ctx.buildRedaction({}),
  );

  expect(result.response.headers).toStrictEqual({
    location: '/callback?code=[redacted:http.query.code]',
  });
});

test('it redacts $.customer.card in request and response JSON', () => {
  const ctx = setupTest();

  const result = buildRedactedExchange(
    ctx.buildExchange({
      requestJSON: { customer: { card: 'planted-body-in', name: 'kept' } },
      responseJSON: { customer: { card: 'planted-body-out', name: 'kept' } },
    }),
    ctx.buildRedaction({ bodyPaths: ['$.customer.card'] }),
  );

  expect({
    request: result.request.json,
    response: result.response.json,
    body: result.response.body,
    secrets: result.secrets,
  }).toStrictEqual({
    request: { customer: { card: '[redacted:http.body]', name: 'kept' } },
    response: { customer: { card: '[redacted:http.body]', name: 'kept' } },
    body: '{"customer":{"card":"[redacted:http.body]","name":"kept"}}',
    secrets: [
      { name: 'http.body', value: 'planted-body-in' },
      { name: 'http.body', value: 'planted-body-out' },
    ],
  });
});

test('it redacts $.items[*].token in each item', () => {
  const ctx = setupTest();

  const result = buildRedactedExchange(
    ctx.buildExchange({
      responseJSON: {
        items: [{ token: 'planted-token-one', id: 1 }, { id: 2 }, { token: 'planted-token-two' }],
      },
    }),
    ctx.buildRedaction({ bodyPaths: ['$.items[*].token'] }),
  );

  expect(result.response.json).toStrictEqual({
    items: [{ token: '[redacted:http.body]', id: 1 }, { id: 2 }, { token: '[redacted:http.body]' }],
  });
});

test('it changes nothing for a body path that matches nothing', () => {
  const ctx = setupTest();

  const exchange = ctx.buildExchange({
    responseJSON: { customer: { card: 'kept-value' }, items: [] },
  });

  const result = buildRedactedExchange(
    exchange,
    ctx.buildRedaction({
      bodyPaths: ['$.missing.deep', '$.customer.card.number', '$.customer[*]', '$.items[*].x'],
    }),
  );

  expect({ response: result.response, secrets: result.secrets }).toStrictEqual({
    response: exchange.response,
    secrets: [],
  });
});

test('it adds each string under an object that a body path reaches', () => {
  const ctx = setupTest();

  const result = buildRedactedExchange(
    ctx.buildExchange({
      requestJSON: { card: { number: 'planted-card-number', cvc: 'planted-cvc' } },
    }),
    ctx.buildRedaction({ bodyPaths: ['$.card'] }),
  );

  expect({ json: result.request.json, secrets: result.secrets }).toStrictEqual({
    json: { card: '[redacted:http.body]' },
    secrets: [
      { name: 'http.body', value: 'planted-card-number' },
      { name: 'http.body', value: 'planted-cvc' },
    ],
  });
});
