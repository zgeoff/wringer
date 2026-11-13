import { expect, test } from 'bun:test';
import { createFakePullRequestHost } from './create-fake-pull-request-host.ts';

function setupTest() {
  const pr = {
    number: 7,
    url: 'https://github.com/acme/shop/pull/7',
    body: 'before',
    baseBranch: 'main',
    state: 'open',
    branch: 'feature',
  } as const;

  return { pr, host: createFakePullRequestHost([pr]) };
}

test('it finds the open pull request of a branch', async () => {
  const ctx = setupTest();

  const found = await ctx.host.findOpen({ branch: 'feature' });

  expect(found).toStrictEqual({ kind: 'one', pr: ctx.pr });
});

test('it finds no pull request for another branch', async () => {
  const ctx = setupTest();

  const found = await ctx.host.findOpen({ branch: 'other' });

  expect(found).toStrictEqual({ kind: 'none' });
});

test('it stores a written body', async () => {
  const ctx = setupTest();

  await ctx.host.writeBody(7, 'after');

  expect(ctx.host.readStoredBody(7)).toBe('after');
});
