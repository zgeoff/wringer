import { z } from 'zod';
import { parseGitHubRepo } from './parse-github-repo.ts';
import type { GitHubRepo } from './parse-github-repo.ts';
import { parsePullRequestView } from './parse-pull-request-view.ts';
import { pickGitHubFailure } from './pick-github-failure.ts';
import type { GitRequest } from './run-git.ts';
import type { ProcessRequest, ProcessResult } from './run-process.ts';
import type { PullRequestFound, PullRequestHost, PullRequestView } from './types.ts';
import { WringerError } from './wringer-error.ts';

export interface GitHubPullRequestHostOptions {
  readonly root: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly runGit: (request: GitRequest) => Promise<ProcessResult>;
  readonly runProcess: (request: ProcessRequest) => Promise<ProcessResult>;
  readonly fetch: typeof fetch;
}

interface GitHubRequest {
  readonly method: 'GET' | 'PATCH';
  readonly path: string;
  readonly query?: URLSearchParams | undefined;
  readonly body?: unknown;
}

// Reads and writes pull request descriptions over GitHub's REST API. The repo and the token are
// resolved on the first request, so a command that never touches a PR needs neither. No error
// carries the token, a request header or a response body.
export function createGitHubPullRequestHost(
  options: GitHubPullRequestHostOptions,
): PullRequestHost {
  let repoRead: Promise<GitHubRepo> | null = null;
  let tokenRead: Promise<string> | null = null;

  const readRepo = (): Promise<GitHubRepo> => {
    repoRead ??= readGitHubRepo(options);

    return repoRead;
  };

  const readToken = (): Promise<string> => {
    tokenRead ??= readGitHubToken(options);

    return tokenRead;
  };

  const sendRequest = async (request: GitHubRequest): Promise<unknown> => {
    const repo = await readRepo();

    const url = buildRequestURL(options.env, repo, request);

    const token = await readToken();

    return sendGitHubRequest(options.fetch, url, token, request);
  };

  return {
    // The port's contract names this `findOpen`, and it reads from GitHub.
    // oxlint-disable-next-line zgeoff/verb-contract
    findOpen: async (request) => {
      if ('number' in request) {
        const pull = await readPull(sendRequest, request.number);

        return { kind: 'one', pr: parseView(pull) };
      }

      const repo = await readRepo();
      const headOwner = await readHeadOwner(options, request.branch, repo);

      const listed = await sendRequest({
        method: 'GET',
        path: 'pulls',
        query: new URLSearchParams({
          state: 'open',
          head: `${headOwner}:${request.branch}`,
          per_page: '100',
        }),
      });

      return pickFound(listed);
    },
    readBody: async (number) => {
      const pull = await readPull(sendRequest, number);

      return parseView(pull);
    },
    writeBody: async (number, body) => {
      await sendRequest({ method: 'PATCH', path: `pulls/${number}`, body: { body } });
    },
  };
}

async function readGitHubRepo(options: GitHubPullRequestHostOptions): Promise<GitHubRepo> {
  const named = options.env['GITHUB_REPOSITORY'];

  if (named !== undefined && named !== '') {
    return parseGitHubRepo(named) ?? failRepo('GITHUB_REPOSITORY is not in the form owner/name.');
  }

  const url = await readRemoteURL(options, 'origin');

  return (
    (url === null ? null : parseGitHubRepo(url)) ??
    failRepo('The origin remote is not a GitHub owner/name URL.')
  );
}

function failRepo(message: string): never {
  throw new WringerError('environment', {
    message,
    hint: 'Set GITHUB_REPOSITORY to owner/name.',
  });
}

function readRemoteURL(
  options: GitHubPullRequestHostOptions,
  remote: string,
): Promise<string | null> {
  return readGitValue(options, ['remote', 'get-url', remote]);
}

// git exits non-zero for an unset key or an unknown remote, which is a normal answer here.
async function readGitValue(
  options: GitHubPullRequestHostOptions,
  args: readonly string[],
): Promise<string | null> {
  try {
    const result = await options.runGit({ cwd: options.root, args });

    const value = result.stdout.trim();

    return value === '' ? null : value;
  } catch {
    return null;
  }
}

const tokenPattern = /^[\u0021-\u007E]+$/u;

async function readGitHubToken(options: GitHubPullRequestHostOptions): Promise<string> {
  const fromEnv = options.env['GITHUB_TOKEN']?.trim() ?? '';
  const token = fromEnv === '' ? await readGHToken(options) : fromEnv;

  if (token === null) {
    throw new WringerError('environment', {
      message: 'No GitHub token was found.',
      hint: 'Set GITHUB_TOKEN, or run `gh auth login`.',
    });
  }

  if (!tokenPattern.test(token)) {
    throw pickGitHubFailure({ status: 401, isWrite: false });
  }

  return token;
}

const ghTimeoutMs = 10_000;

async function readGHToken(options: GitHubPullRequestHostOptions): Promise<string | null> {
  try {
    const result = await options.runProcess({
      argv: ['gh', 'auth', 'token'],
      cwd: options.root,
      env: options.env,
      signal: AbortSignal.timeout(ghTimeoutMs),
    });

    const token = result.stdout.trim();

    return result.exitCode === 0 && token !== '' ? token : null;
  } catch {
    return null;
  }
}

const defaultAPIURL = 'https://api.github.com';

function buildRequestURL(
  env: Readonly<Record<string, string | undefined>>,
  repo: GitHubRepo,
  request: GitHubRequest,
): URL {
  const base = env['GITHUB_API_URL'] ?? defaultAPIURL;

  if (!URL.canParse(base)) {
    throw new WringerError('environment', { message: 'GITHUB_API_URL is not a URL.' });
  }

  const apiURL = new URL(base);

  const url = new URL(
    `${apiURL.pathname.replace(/\/+$/u, '')}/repos/${repo.owner}/${repo.name}/${request.path}`,
    apiURL,
  );

  url.search = request.query?.toString() ?? '';

  // The token goes in a header, so a plain-HTTP API would send it in the clear. A path such as
  // `//host` resolves to another host, so the check reads the resolved request URL.
  if (url.origin !== apiURL.origin || !isSecureURL(url)) {
    throw new WringerError('environment', { message: 'GITHUB_API_URL must be an https URL.' });
  }

  return url;
}

const loopbackHosts = new Set(['127.0.0.1', '[::1]', 'localhost']);

function isSecureURL(url: URL): boolean {
  return url.protocol === 'https:' || loopbackHosts.has(url.hostname);
}

async function sendGitHubRequest(
  fetchRequest: typeof fetch,
  url: URL,
  token: string,
  request: GitHubRequest,
): Promise<unknown> {
  const isWrite = request.method !== 'GET';
  let response: Response;

  try {
    // A redirect would carry the token to wherever it points.
    response = await fetchRequest(url, {
      method: request.method,
      redirect: 'manual',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'wringer',
        ...(isWrite ? { 'Content-Type': 'application/json' } : {}),
      },
      body: isWrite ? JSON.stringify(request.body) : null,
    });
  } catch {
    throw new WringerError('environment', { message: 'Could not reach GitHub.' });
  }

  if (response.status !== 200) {
    throw pickGitHubFailure({ status: response.status, isWrite });
  }

  try {
    const answer: unknown = await response.json();

    return answer;
  } catch {
    throw buildUnreadableAnswer();
  }
}

function buildUnreadableAnswer(): WringerError {
  return new WringerError('environment', {
    message: 'GitHub answered in a shape wringer does not know.',
  });
}

function readPull(
  send: (request: GitHubRequest) => Promise<unknown>,
  number: number,
): Promise<unknown> {
  return send({ method: 'GET', path: `pulls/${number}` });
}

function parseView(value: unknown): PullRequestView {
  const view = parsePullRequestView(value);

  if (view === null) {
    throw buildUnreadableAnswer();
  }

  return view;
}

// The owner of the branch's push remote, so a branch pushed to a fork finds its PR.
async function readHeadOwner(
  options: GitHubPullRequestHostOptions,
  branch: string,
  repo: GitHubRepo,
): Promise<string> {
  const pushRemote = await readGitValue(options, [
    'config',
    '--get',
    `branch.${branch}.pushRemote`,
  ]);

  const branchRemote = await readGitValue(options, ['config', '--get', `branch.${branch}.remote`]);

  const remote = pushRemote ?? branchRemote ?? 'origin';

  const url = await readRemoteURL(options, remote);

  return (url === null ? null : parseGitHubRepo(url)?.owner) ?? repo.owner;
}

function pickFound(listed: unknown): PullRequestFound {
  const items = z.array(z.unknown()).safeParse(listed);

  if (!items.success) {
    throw buildUnreadableAnswer();
  }

  const views = items.data.map(parseView);
  const [first, ...others] = views;

  if (first === undefined) {
    return { kind: 'none' };
  }

  return others.length === 0
    ? { kind: 'one', pr: first }
    : { kind: 'many', numbers: views.map((view) => view.number) };
}
