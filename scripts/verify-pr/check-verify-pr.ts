import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileSystem } from '../ci/file-system.ts';
import { nodeFileSystem } from '../ci/node-file-system.ts';
import type { CommandResult, RunCommand } from '../ci/run-command.ts';
import { runCommand } from '../ci/run-command.ts';
import { parseReportBlock } from './parse-report-block.ts';
import { pickGateCheck } from './pick-gate-check.ts';
import type { GateCheck } from './pick-gate-check.ts';
import { pickRegistryCheck } from './pick-registry-check.ts';
import type { CheckResult } from './pick-registry-check.ts';

const checkNames = ['pull-request', 'report-block', 'registry', 'gate'] as const;

type CheckName = (typeof checkNames)[number];

// The JSON object on stdout.
export interface PRCheck {
  readonly ok: boolean;
  readonly pr: number | null;
  readonly checks: readonly {
    readonly name: CheckName;
    readonly ok: boolean;
    readonly detail: string;
  }[];
}

export interface VerifyPROptions {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly runCommand: RunCommand;
  readonly fileSystem: FileSystem;

  // A folder for the description file that `gate` reads.
  readonly tempDirectory: string;

  // The registry name that this repo's CLI reports.
  readonly registry: string;
}

export interface VerifyPRResult {
  readonly exitCode: 0 | 1 | 2;
  readonly check: PRCheck | null;
  readonly error: string | null;
}

const skipped = 'skipped: an earlier check failed';

// Runs each check in order and skips the rest after the first failure. A run that cannot happen,
// such as a missing `gh`, gives exit code 2 and no verdict.
export async function checkVerifyPR(options: VerifyPROptions): Promise<VerifyPRResult> {
  const lookup = await readPullRequest(options);

  if (lookup.kind === 'cannot-run') {
    return { exitCode: 2, check: null, error: lookup.message };
  }

  if (lookup.kind === 'none') {
    const noPullRequest = new Map([
      ['pull-request', { ok: false, detail: lookup.detail }],
    ] as const);

    return {
      exitCode: 2,
      check: buildCheck(null, noPullRequest),
      error: null,
    };
  }

  const pr = lookup.pullRequest;

  if (isReleasePR(pr)) {
    const released = new Map<CheckName, CheckResult>(
      checkNames.map((name) => [
        name,
        name === 'pull-request'
          ? { ok: true, detail: `#${pr.number} into ${pr.baseRefName}` }
          : { ok: true, detail: releaseSkip },
      ]),
    );

    return { exitCode: 0, check: buildCheck(pr.number, released), error: null };
  }

  const base = await readBaseRef(options, pr.baseRefName);

  if (base === null) {
    return {
      exitCode: 2,
      check: null,
      error: `the base ref ${pr.baseRefName} is not fetched; fetch it, then run again`,
    };
  }

  const results = new Map<CheckName, CheckResult>([
    ['pull-request', { ok: true, detail: `#${pr.number} into ${pr.baseRefName}` }],
  ]);

  const block = parseReportBlock(pr.body);

  const blockResult = block.ok
    ? { ok: true, detail: 'one report block under ## Verification' }
    : block;

  results.set('report-block', blockResult);

  if (block.ok) {
    results.set('registry', pickRegistryCheck(block.block, options.registry));
  }

  if (results.get('registry')?.ok === true) {
    const gate = await runGate(options, base, pr.body);

    if (gate.kind === 'cannot-run') {
      return { exitCode: 2, check: null, error: gate.message };
    }

    results.set('gate', gate.result);
  }

  const check = buildCheck(pr.number, results);

  return { exitCode: check.ok ? 0 : 1, check, error: null };
}

interface PullRequest {
  readonly number: number;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly body: string;
}

const releaseSkip = 'skipped: a release pull request carries no verify report';

type PullRequestLookup =
  | { readonly kind: 'found'; readonly pullRequest: PullRequest }
  | { readonly kind: 'none'; readonly detail: string }
  | { readonly kind: 'cannot-run'; readonly message: string };

async function readPullRequest(options: VerifyPROptions): Promise<PullRequestLookup> {
  const number = options.env['PR_NUMBER'];
  const selector = number === undefined || number === '' ? [] : [number];

  const result = await tryRun(options, [
    'gh',
    'pr',
    'view',
    ...selector,
    '--json',
    'number,baseRefName,headRefName,body',
  ]);

  if (result === null) {
    return { kind: 'cannot-run', message: 'gh is not installed or cannot start' };
  }

  if (result.exitCode !== 0) {
    return /no pull requests found/iu.test(result.stderr)
      ? { kind: 'none', detail: 'no pull request found for this branch' }
      : { kind: 'cannot-run', message: `gh pr view failed: ${result.stderr.trim()}` };
  }

  const pullRequest = parsePullRequest(result.stdout);

  return pullRequest === null
    ? { kind: 'cannot-run', message: 'gh pr view printed an unexpected answer' }
    : { kind: 'found', pullRequest };
}

async function tryRun(
  options: VerifyPROptions,
  argv: readonly string[],
): Promise<CommandResult | null> {
  try {
    return await options.runCommand(argv, { cwd: options.cwd, env: options.env });
  } catch {
    return null;
  }
}

function parsePullRequest(text: string): PullRequest | null {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }

  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const fields = Object.fromEntries(Object.entries(value));

  if (typeof fields['number'] !== 'number' || typeof fields['baseRefName'] !== 'string') {
    return null;
  }

  return {
    number: fields['number'],
    baseRefName: fields['baseRefName'],
    headRefName: typeof fields['headRefName'] === 'string' ? fields['headRefName'] : '',
    body: typeof fields['body'] === 'string' ? fields['body'] : '',
  };
}

function buildCheck(pr: number | null, results: ReadonlyMap<CheckName, CheckResult>): PRCheck {
  const checks = checkNames.map((name) => {
    const result = results.get(name) ?? { ok: false, detail: skipped };

    return { name, ok: result.ok, detail: result.detail };
  });

  return { ok: checks.every((check) => check.ok), pr, checks };
}

// release-please opens its pull request from a `release-please--` branch. It changes only versions
// and changelogs, and nobody runs a journey on it, so it never holds a report.
function isReleasePR(pr: PullRequest): boolean {
  return pr.headRefName.startsWith('release-please--');
}

async function readBaseRef(options: VerifyPROptions, baseBranch: string): Promise<string | null> {
  for (const ref of [`origin/${baseBranch}`, baseBranch]) {
    const result = await tryRun(options, ['git', 'rev-parse', '--verify', '--quiet', ref]);

    if (result?.exitCode === 0) {
      return ref;
    }
  }

  return null;
}

async function runGate(options: VerifyPROptions, base: string, body: string): Promise<GateCheck> {
  const bodyFile = join(options.tempDirectory, 'description.md');

  await options.fileSystem.writeText(bodyFile, body);

  const result = await tryRun(options, [
    'bun',
    'verify',
    'gate',
    '--base',
    base,
    '--body-file',
    bodyFile,
    '--json',
  ]);

  return pickGateCheck(result?.stdout ?? '');
}

if (import.meta.main) {
  const tempDirectory = await mkdtemp(join(tmpdir(), 'verify-pr-'));

  try {
    const result = await checkVerifyPR({
      cwd: process.cwd(),
      env: process.env,
      runCommand,
      fileSystem: nodeFileSystem,
      tempDirectory,
      registry: 'wringer',
    });

    if (result.check !== null) {
      process.stdout.write(`${JSON.stringify(result.check)}\n`);
    }

    if (result.error !== null) {
      process.stderr.write(`${result.error}\n`);
    }

    process.exitCode = result.exitCode;
  } finally {
    await nodeFileSystem.removePath(tempDirectory);
  }
}
