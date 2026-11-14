import { expect, test } from 'bun:test';
import { pickLinkFailure } from './pick-link-failure.ts';

function setupTest() {
  return { uploader: { linkHosts: ['files.example'], maxURLLength: 40 } };
}

test('it accepts an https link on a listed host', () => {
  const ctx = setupTest();

  expect(
    pickLinkFailure({ url: 'https://files.example/a.png', expiresAt: null }, ctx.uploader),
  ).toBeNull();
});

test.each([
  ['a link that is not a URL', 'not a url', /not a URL/u],
  ['a link that is not https', 'http://files.example/a.png', /not https/u],
  ['a link on another host', 'https://other.example/a.png', /host the uploader does not list/u],
  ['a link too long', `https://files.example/${'a'.repeat(30)}`, /longer than 40/u],
  ['a link whose host only starts with a listed one', 'https://files.example.evil/a', /host/u],
])('it refuses %s', (_name, url, message) => {
  const ctx = setupTest();

  expect(pickLinkFailure({ url, expiresAt: null }, ctx.uploader)).toMatch(message);
});

test('it counts the HTML-escaped length of the link', () => {
  const ctx = setupTest();
  const url = `https://files.example/?${'a=1&'.repeat(5)}`;

  expect(pickLinkFailure({ url, expiresAt: null }, ctx.uploader)).toMatch(/longer than 40/u);
});

test('it counts the percent-encoded length of the link', () => {
  const ctx = setupTest();
  const url = 'https://files.example/é é é é é é';

  expect(pickLinkFailure({ url, expiresAt: null }, ctx.uploader)).toMatch(/longer than 40/u);
});

test('it refuses an expiry that is not a time', () => {
  const ctx = setupTest();

  expect(
    pickLinkFailure({ url: 'https://files.example/a', expiresAt: 'soon' }, ctx.uploader),
  ).toMatch(/expiry/u);
});

test('it never repeats the link in its reason', () => {
  const ctx = setupTest();

  expect(
    pickLinkFailure(
      { url: 'http://files.example/secret-capability', expiresAt: null },
      ctx.uploader,
    ),
  ).not.toContain('secret-capability');
});
