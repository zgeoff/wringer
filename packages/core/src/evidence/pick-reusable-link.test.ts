import { expect, test } from 'bun:test';
import { pickReusableLink } from './pick-reusable-link.ts';

function setupTest() {
  const key = 'files.example abc.png';

  return {
    key,
    now: Date.parse('2026-11-13T00:00:00.000Z'),
    buildRecord: (expiresAt: string | undefined) => ({
      [key]: {
        url: 'https://files.example/a.png',
        expiresAt,
        uploadedAt: '2026-11-01T00:00:00.000Z',
      },
    }),
  };
}

test('it reuses a link with exactly 7 days left', () => {
  const ctx = setupTest();

  expect(
    pickReusableLink(ctx.buildRecord('2026-11-20T00:00:00.000Z'), ctx.key, ctx.now),
  ).toStrictEqual({
    url: 'https://files.example/a.png',
    expiresAt: '2026-11-20T00:00:00.000Z',
  });
});

test('it uploads again when the link has less than 7 days left', () => {
  const ctx = setupTest();

  expect(
    pickReusableLink(ctx.buildRecord('2026-11-19T23:59:59.999Z'), ctx.key, ctx.now),
  ).toBeNull();
});

test('it reuses a link that never expires', () => {
  const ctx = setupTest();

  expect(pickReusableLink(ctx.buildRecord(undefined), ctx.key, ctx.now)).toStrictEqual({
    url: 'https://files.example/a.png',
    expiresAt: null,
  });
});

test('it finds nothing for another key', () => {
  const ctx = setupTest();

  expect(pickReusableLink(ctx.buildRecord(undefined), 'other.example abc.png', ctx.now)).toBeNull();
});

test('it finds nothing for a key that names an inherited property', () => {
  const ctx = setupTest();

  expect(pickReusableLink({}, 'constructor', ctx.now)).toBeNull();
});
