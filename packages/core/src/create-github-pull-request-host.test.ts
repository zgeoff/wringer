import { expect, onTestFinished, test } from 'bun:test';
import { createGitHubPullRequestHost } from './create-github-pull-request-host.ts';
import { runGit } from './run-git.ts';
import { runProcess } from './run-process.ts';
import { buildStandInPull } from './test-utils/build-stand-in-pull.ts';
import { createFakeGH } from './test-utils/create-fake-gh.ts';
import { createGitHubStandIn } from './test-utils/create-github-stand-in.ts';
import type { StandInPull } from './test-utils/create-github-stand-in.ts';
import { createTestRepo } from './test-utils/create-test-repo.ts';

interface SetupOptions {
  readonly pulls?: readonly StandInPull[];
  readonly forceStatus?: number;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

async function setupTest(options: SetupOptions = {}) {
  const token = 'ghp_standintoken0123456789';

  const repo = await createTestRepo(import.meta.dir);

  onTestFinished(() => repo.remove());

  const standIn = createGitHubStandIn({
    token,
    pulls: options.pulls ?? [],
    forceStatus: options.forceStatus,
  });

  await repo.git('remote', 'add', 'origin', 'https://github.com/acme/shop.git');

  const host = createGitHubPullRequestHost({
    root: repo.root,
    env: {
      GITHUB_API_URL: standIn.url,
      GITHUB_TOKEN: token,
      ...options.env,
    },
    runGit,
    runProcess,
    fetch,
  });

  return { token, host, standIn, git: repo.git, root: repo.root };
}

test('#findOpen finds the one open pull request of a branch', async () => {
  const ctx = await setupTest({ pulls: [buildStandInPull()] });
  const found = await ctx.host.findOpen({ branch: 'feature' });

  expect(found).toStrictEqual({
    kind: 'one',
    pr: {
      number: 7,
      url: 'https://github.com/acme/shop/pull/7',
      body: 'Hello',
      baseBranch: 'main',
      state: 'open',
    },
  });
});

test('#findOpen finds none for a branch with no open pull request', async () => {
  const ctx = await setupTest({ pulls: [buildStandInPull({ state: 'closed' })] });
  const found = await ctx.host.findOpen({ branch: 'feature' });

  expect(found).toStrictEqual({ kind: 'none' });
});

test('#findOpen lists every number when a branch has several open pull requests', async () => {
  const ctx = await setupTest({ pulls: [buildStandInPull(), buildStandInPull({ number: 9 })] });
  const found = await ctx.host.findOpen({ branch: 'feature' });

  expect(found).toStrictEqual({
    kind: 'many',
    numbers: [7, 9],
  });
});

test('#findOpen finds a pull request by number in any state, with its merged state', async () => {
  const ctx = await setupTest({
    pulls: [buildStandInPull({ state: 'closed', mergedAt: '2026-01-01T00:00:00Z' })],
  });

  const found = await ctx.host.findOpen({ number: 7 });

  expect(found).toMatchObject({ kind: 'one', pr: { number: 7, state: 'merged' } });
});

test('#findOpen gives an empty description as an empty string', async () => {
  const ctx = await setupTest({ pulls: [buildStandInPull({ body: null })] });
  const found = await ctx.host.findOpen({ branch: 'feature' });

  expect(found).toMatchObject({ kind: 'one', pr: { body: '' } });
});

test('#findOpen looks for the head under the owner of the branch push remote', async () => {
  const ctx = await setupTest();

  await ctx.git('remote', 'add', 'fork', 'git@github.com:someone/shop.git');
  await ctx.git('config', 'branch.feature.pushRemote', 'fork');
  await ctx.host.findOpen({ branch: 'feature' });

  expect(ctx.standIn.requests.map((request) => request.head)).toStrictEqual(['someone:feature']);
});

test('#findOpen falls back to the branch remote, then to origin', async () => {
  const ctx = await setupTest();

  await ctx.git('remote', 'add', 'fork', 'git@github.com:someone/shop.git');
  await ctx.git('config', 'branch.feature.remote', 'fork');
  await ctx.host.findOpen({ branch: 'feature' });
  await ctx.host.findOpen({ branch: 'other' });

  expect(ctx.standIn.requests.map((request) => request.head)).toStrictEqual([
    'someone:feature',
    'acme:other',
  ]);
});

test('#readBody reads the description of a pull request', async () => {
  const ctx = await setupTest({ pulls: [buildStandInPull()] });
  const view = await ctx.host.readBody(7);

  expect(view.body).toBe('Hello');
});

test('#writeBody replaces the description', async () => {
  const ctx = await setupTest({ pulls: [buildStandInPull()] });

  await ctx.host.writeBody(7, 'New text');

  expect(ctx.standIn.readBody(7)).toBe('New text');
});

test('it takes the repo from GITHUB_REPOSITORY over the origin remote', async () => {
  const ctx = await setupTest({ env: { GITHUB_REPOSITORY: 'other/place' } });

  await ctx.host.findOpen({ number: 7 }).catch(() => null);

  expect(ctx.standIn.requests.map((request) => request.path)).toStrictEqual([
    '/repos/other/place/pulls/7',
  ]);
});

test('it fails when the origin remote is not a GitHub URL', async () => {
  const ctx = await setupTest();

  await ctx.git('remote', 'set-url', 'origin', '/srv/git/shop');

  expect(ctx.host.readBody(7)).rejects.toMatchObject({ code: 'environment' });
});

test.each([
  [401, 'The GitHub token is not valid.'],
  [403, 'The GitHub token cannot reach this pull request.'],
  [404, 'The GitHub token cannot reach this pull request.'],
])('it maps HTTP %i on a read to its message', async (status, message) => {
  const ctx = await setupTest({ forceStatus: status });

  expect(ctx.host.readBody(7)).rejects.toMatchObject({ code: 'environment', message });
});

test('it maps HTTP 401 on a write to the invalid token message', async () => {
  const ctx = await setupTest({
    pulls: [buildStandInPull()],
    env: { GITHUB_TOKEN: 'ghp_wrongtoken' },
  });

  expect(ctx.host.writeBody(7, 'x')).rejects.toMatchObject({
    message: 'The GitHub token is not valid.',
  });
});

test('it maps HTTP 404 for a missing pull request to the unreachable message', async () => {
  const ctx = await setupTest({ pulls: [buildStandInPull()] });

  expect(ctx.host.readBody(99)).rejects.toMatchObject({
    message: 'The GitHub token cannot reach this pull request.',
  });
});

test('it maps HTTP 422 on a write to the refused description message', async () => {
  const ctx = await setupTest({ pulls: [buildStandInPull()] });

  expect(ctx.host.writeBody(7, 'x'.repeat(65_537))).rejects.toMatchObject({
    code: 'environment',
    message: 'GitHub refused the description.',
  });
});

test('it reports any other status by its number', async () => {
  const ctx = await setupTest({ forceStatus: 502 });

  expect(ctx.host.readBody(7)).rejects.toMatchObject({ message: 'GitHub answered HTTP 502.' });
});

test('it reports an unreachable GitHub without the address', async () => {
  const ctx = await setupTest({ env: { GITHUB_API_URL: 'http://127.0.0.1:1' } });

  expect(ctx.host.readBody(7)).rejects.toMatchObject({ message: 'Could not reach GitHub.' });
});

test('it refuses a plain-HTTP API URL that is not loopback, before it sends the token', async () => {
  const ctx = await setupTest({ env: { GITHUB_API_URL: 'http://github.example.test' } });

  expect(ctx.host.readBody(7)).rejects.toMatchObject({
    message: 'GITHUB_API_URL must be an https URL.',
  });
});

test('it sends the GITHUB_TOKEN as a bearer token', async () => {
  const ctx = await setupTest({ pulls: [buildStandInPull()] });

  await ctx.host.readBody(7);

  expect(ctx.standIn.requests.map((request) => request.authorization)).toStrictEqual([
    `Bearer ${ctx.token}`,
  ]);
});

test('it takes the token from `gh auth token` when GITHUB_TOKEN is unset', async () => {
  const ctx = await setupTest({ pulls: [buildStandInPull()], env: { GITHUB_TOKEN: '' } });
  const path = await createFakeGH(ctx.root, `echo ${ctx.token}`);

  const host = createGitHubPullRequestHost({
    root: ctx.root,
    env: { GITHUB_API_URL: ctx.standIn.url, PATH: path },
    runGit,
    runProcess,
    fetch,
  });

  const view = await host.readBody(7);

  expect(view.number).toBe(7);
});

test('it fails without a token when gh exits non-zero, and never leaks its output', async () => {
  const ctx = await setupTest({ pulls: [buildStandInPull()] });
  const path = await createFakeGH(ctx.root, `echo ${ctx.token}; echo ${ctx.token} >&2; exit 1`);

  const host = createGitHubPullRequestHost({
    root: ctx.root,
    env: { GITHUB_API_URL: ctx.standIn.url, PATH: path },
    runGit,
    runProcess,
    fetch,
  });

  expect(host.readBody(7)).rejects.toMatchObject({
    code: 'environment',
    message: 'No GitHub token was found.',
  });
});

test('it fails without a token when gh is not installed', async () => {
  const ctx = await setupTest({ pulls: [buildStandInPull()] });

  const host = createGitHubPullRequestHost({
    root: ctx.root,
    env: { GITHUB_API_URL: ctx.standIn.url, PATH: '/nonexistent' },
    runGit,
    runProcess,
    fetch,
  });

  expect(host.readBody(7)).rejects.toMatchObject({ message: 'No GitHub token was found.' });
});

test.each([401, 403, 404, 422, 502])(
  'it keeps the token out of the error for HTTP %i',
  async (status) => {
    const ctx = await setupTest({ forceStatus: status });
    const error = await ctx.host.readBody(7).catch((error_: unknown) => error_);

    expect(JSON.stringify({ error, message: String(error) })).not.toContain(ctx.token);
  },
);

test('it keeps a token that is not a header value out of the error', async () => {
  const badToken = 'ghp_bad\ntoken';

  const ctx = await setupTest({ env: { GITHUB_TOKEN: badToken } });
  const error = await ctx.host.readBody(7).catch((error_: unknown) => error_);

  expect(String(error)).not.toContain('ghp_bad');
});

test('it does not follow a redirect with the token', async () => {
  const ctx = await setupTest({ forceStatus: 301 });

  expect(ctx.host.readBody(7)).rejects.toMatchObject({ message: 'GitHub answered HTTP 301.' });
});
