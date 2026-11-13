import { expect, test } from 'bun:test';
import { createGitHubStandIn } from './create-github-stand-in.ts';

test('it answers a request with the wrong token as 401', async () => {
  const standIn = createGitHubStandIn({ token: 'right', pulls: [] });

  const response = await fetch(`${standIn.url}/repos/acme/shop/pulls`, {
    headers: { Authorization: 'Bearer wrong' },
  });

  expect(response.status).toBe(401);
});

test('it lists the open pull requests of a head', async () => {
  const standIn = createGitHubStandIn({
    token: 'right',
    pulls: [{ number: 3, head: 'feature', state: 'open', body: 'text', base: 'main' }],
  });

  const response = await fetch(`${standIn.url}/repos/acme/shop/pulls?head=acme%3Afeature`, {
    headers: { Authorization: 'Bearer right' },
  });

  const listed: unknown = await response.json();

  expect(listed).toStrictEqual([
    {
      number: 3,
      html_url: 'https://github.com/acme/shop/pull/3',
      body: 'text',
      state: 'open',
      merged_at: null,
      base: { ref: 'main' },
    },
  ]);
});

test('it keeps a patched body', async () => {
  const standIn = createGitHubStandIn({
    token: 'right',
    pulls: [{ number: 3, head: 'feature', state: 'open', body: null, base: 'main' }],
  });

  await fetch(`${standIn.url}/repos/acme/shop/pulls/3`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer right' },
    body: JSON.stringify({ body: 'new' }),
  });

  expect(standIn.readBody(3)).toBe('new');
});
