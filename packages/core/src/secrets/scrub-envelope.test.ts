import { expect, test } from 'bun:test';
import type { Envelope } from '../envelope/envelope.ts';
import { createSecretSet } from './create-secret-set.ts';
import { scrubEnvelope } from './scrub-envelope.ts';

function setupTest() {
  const secrets = createSecretSet();

  secrets.add({ name: 'SHOP_API_TOKEN', value: 'planted-shop-token', origin: 'declared' });

  const envelope: Envelope = {
    wringer: 1,
    ok: true,
    command: 'action',
    target: 'local',
    instance: 'run-1',
    feature: 'checkout',
    sha: 'abc1234',
    durationMs: 5,
    data: null,
    evidence: [],
    cursors: {},
    error: null,
  };

  return { secrets, envelope };
}

test('#scrubEnvelope scrubs the kind and the path of an evidence item', () => {
  const ctx = setupTest();

  const scrubbed = scrubEnvelope(
    {
      ...ctx.envelope,
      evidence: [
        {
          kind: 'planted-shop-token',
          path: '.wringer/planted-shop-token.txt',
          sha256: 'a'.repeat(64),
          scrub: 'text',
        },
      ],
    },
    ctx.secrets,
  );

  expect(scrubbed.evidence).toStrictEqual([
    {
      kind: '[redacted:SHOP_API_TOKEN]',
      path: '.wringer/[redacted:SHOP_API_TOKEN].txt',
      sha256: 'a'.repeat(64),
      scrub: 'text',
    },
  ]);
});

test('#scrubEnvelope scrubs a cursor key and keeps its value', () => {
  const ctx = setupTest();

  const scrubbed = scrubEnvelope(
    { ...ctx.envelope, cursors: { 'planted-shop-token': 3 } },
    ctx.secrets,
  );

  expect(scrubbed.cursors).toStrictEqual({ '[redacted:SHOP_API_TOKEN]': 3 });
});

test('#scrubEnvelope scrubs the command, target, instance, feature and sha', () => {
  const ctx = setupTest();

  const scrubbed = scrubEnvelope(
    {
      ...ctx.envelope,
      command: 'planted-shop-token',
      target: 'planted-shop-token',
      instance: 'planted-shop-token',
      feature: 'planted-shop-token',
      sha: 'planted-shop-token',
    },
    ctx.secrets,
  );

  expect([
    scrubbed.command,
    scrubbed.target,
    scrubbed.instance,
    scrubbed.feature,
    scrubbed.sha,
  ]).toStrictEqual(Array.from({ length: 5 }, () => '[redacted:SHOP_API_TOKEN]'));
});

test('#scrubEnvelope scrubs the data, the truncated path and the error text', () => {
  const ctx = setupTest();

  const scrubbed = scrubEnvelope(
    {
      ...ctx.envelope,
      ok: false,
      data: { 'planted-shop-token': ['planted-shop-token'] },
      truncated: true,
      truncatedPath: 'planted-shop-token.json',
      error: { code: 'internal', message: 'planted-shop-token', hint: 'planted-shop-token' },
    },
    ctx.secrets,
  );

  expect({
    data: scrubbed.data,
    truncatedPath: scrubbed.truncatedPath,
    error: scrubbed.error,
  }).toStrictEqual({
    data: { '[redacted:SHOP_API_TOKEN]': ['[redacted:SHOP_API_TOKEN]'] },
    truncatedPath: '[redacted:SHOP_API_TOKEN].json',
    error: {
      code: 'internal',
      message: '[redacted:SHOP_API_TOKEN]',
      hint: '[redacted:SHOP_API_TOKEN]',
    },
  });
});
