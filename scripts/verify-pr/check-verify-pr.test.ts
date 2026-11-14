import { expect, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { createTestFolder } from '@wringer/core/test-utils/create-test-folder.ts';
import { nodeFileSystem } from '../ci/node-file-system.ts';
import type { CommandResult, RunCommand } from '../ci/run-command.ts';
import { checkVerifyPR } from './check-verify-pr.ts';

interface Answers {
  readonly gh?: CommandResult | 'missing';
  readonly gate?: CommandResult;
  readonly baseFetched?: boolean;
}

async function setupTest(answers: Answers) {
  const directory = await createTestFolder(import.meta.dir, 'check-verify-pr');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const calls: string[][] = [];

  const runFake: RunCommand = (argv) => {
    calls.push([...argv]);

    if (argv[0] === 'gh') {
      return answers.gh === undefined || answers.gh === 'missing'
        ? Promise.reject(new Error('spawn gh ENOENT'))
        : Promise.resolve(answers.gh);
    }

    if (argv[0] === 'git') {
      return Promise.resolve({
        exitCode: answers.baseFetched === false ? 1 : 0,
        stdout: '',
        stderr: '',
      });
    }

    return Promise.resolve(answers.gate ?? { exitCode: 1, stdout: '', stderr: 'no gate answer' });
  };

  return {
    calls,
    runCheck: (env: Readonly<Record<string, string>> = {}) =>
      checkVerifyPR({
        cwd: directory,
        env,
        runCommand: runFake,
        fileSystem: nodeFileSystem,
        tempDirectory: directory,
        registry: 'wringer',
      }),
  };
}

test('it prints pr null and exits 2 when the branch has no PR', async () => {
  const ctx = await setupTest({
    gh: { exitCode: 1, stdout: '', stderr: 'no pull requests found for branch "x"' },
  });

  const result = await ctx.runCheck();

  expect(result).toStrictEqual({
    exitCode: 2,
    error: null,
    check: {
      ok: false,
      pr: null,
      checks: [
        { name: 'pull-request', ok: false, detail: 'no pull request found for this branch' },
        { name: 'report-block', ok: false, detail: 'skipped: an earlier check failed' },
        { name: 'registry', ok: false, detail: 'skipped: an earlier check failed' },
        { name: 'gate', ok: false, detail: 'skipped: an earlier check failed' },
      ],
    },
  });
});

test('it exits 2 when gh is missing', async () => {
  const ctx = await setupTest({ gh: 'missing' });
  const result = await ctx.runCheck();

  expect(result).toStrictEqual({
    exitCode: 2,
    check: null,
    error: 'gh is not installed or cannot start',
  });
});

test('it exits 2 when the base ref is not fetched', async () => {
  const ctx = await setupTest({
    gh: {
      exitCode: 0,
      stdout: JSON.stringify({ number: 142, baseRefName: 'main', body: '' }),
      stderr: '',
    },
    baseFetched: false,
  });

  const result = await ctx.runCheck();

  expect(result).toStrictEqual({
    exitCode: 2,
    check: null,
    error: 'the base ref main is not fetched; fetch it, then run again',
  });
});

test('it fails report-block and skips the rest for a description with no report block', async () => {
  const ctx = await setupTest({
    gh: {
      exitCode: 0,
      stdout: JSON.stringify({ number: 142, baseRefName: 'main', body: null }),
      stderr: '',
    },
  });

  const result = await ctx.runCheck();

  expect(result).toStrictEqual({
    exitCode: 1,
    error: null,
    check: {
      ok: false,
      pr: 142,
      checks: [
        { name: 'pull-request', ok: true, detail: '#142 into main' },
        {
          name: 'report-block',
          ok: false,
          detail: 'the description holds no wringer report block',
        },
        { name: 'registry', ok: false, detail: 'skipped: an earlier check failed' },
        { name: 'gate', ok: false, detail: 'skipped: an earlier check failed' },
      ],
    },
  });

  expect(ctx.calls.some((call) => call[0] === 'bun')).toBe(false);
});

test('it fails registry for a report from the shop registry and skips the gate', async () => {
  const body = `## Verification\n\n<!-- wringer:report -->\nrows\n<!-- wringer-data v2 {"version":2,"registry":"shop","claims":[]} -->\n<!-- /wringer:report -->\n`;

  const ctx = await setupTest({
    gh: {
      exitCode: 0,
      stdout: JSON.stringify({ number: 142, baseRefName: 'main', body }),
      stderr: '',
    },
  });

  const result = await ctx.runCheck({ PR_NUMBER: '142' });

  expect(result.check?.checks).toStrictEqual([
    { name: 'pull-request', ok: true, detail: '#142 into main' },
    { name: 'report-block', ok: true, detail: 'one report block under ## Verification' },
    { name: 'registry', ok: false, detail: 'the report is from shop; this CLI is wringer' },
    { name: 'gate', ok: false, detail: 'skipped: an earlier check failed' },
  ]);

  expect(ctx.calls[0]).toStrictEqual([
    'gh',
    'pr',
    'view',
    '142',
    '--json',
    'number,baseRefName,headRefName,body',
  ]);
});

test('it passes a release pull request with no report block and runs no gate', async () => {
  const ctx = await setupTest({
    gh: {
      exitCode: 0,
      stdout: JSON.stringify({
        number: 140,
        baseRefName: 'main',
        headRefName: 'release-please--branches--main',
        body: 'a changelog',
      }),
      stderr: '',
    },
  });

  const result = await ctx.runCheck({ PR_NUMBER: '140' });

  expect(result).toStrictEqual({
    exitCode: 0,
    error: null,
    check: {
      ok: true,
      pr: 140,
      checks: [
        { name: 'pull-request', ok: true, detail: '#140 into main' },
        {
          name: 'report-block',
          ok: true,
          detail: 'skipped: a release pull request carries no verify report',
        },
        {
          name: 'registry',
          ok: true,
          detail: 'skipped: a release pull request carries no verify report',
        },
        {
          name: 'gate',
          ok: true,
          detail: 'skipped: a release pull request carries no verify report',
        },
      ],
    },
  });

  expect(ctx.calls.some((call) => call[0] === 'bun')).toBe(false);
});

test('it prints the failing features of a gate that fails', async () => {
  const body = `## Verification\n\n<!-- wringer:report -->\n<!-- wringer-data v2 {"version":2,"registry":"wringer","claims":[]} -->\n<!-- /wringer:report -->\n`;

  const ctx = await setupTest({
    gh: {
      exitCode: 0,
      stdout: JSON.stringify({ number: 142, baseRefName: 'main', body }),
      stderr: '',
    },
    gate: {
      exitCode: 1,
      stdout: JSON.stringify({
        ok: false,
        data: { failing: [{ name: 'core', reason: 'no verdict in the report' }], unmapped: [] },
        error: { message: 'x' },
      }),
      stderr: '',
    },
  });

  const result = await ctx.runCheck();

  expect(result.exitCode).toBe(1);

  expect(result.check?.checks.at(-1)).toStrictEqual({
    name: 'gate',
    ok: false,
    detail: 'failing features: core (no verdict in the report)',
  });
});

test('it exits 0 when every check passes', async () => {
  const body = `## Verification\n\n<!-- wringer:report -->\n<!-- wringer-data v2 {"version":2,"registry":"wringer","claims":[]} -->\n<!-- /wringer:report -->\n`;

  const ctx = await setupTest({
    gh: {
      exitCode: 0,
      stdout: JSON.stringify({ number: 142, baseRefName: 'main', body }),
      stderr: '',
    },
    gate: {
      exitCode: 0,
      stdout: JSON.stringify({ ok: true, data: { failing: [], unmapped: [] }, error: null }),
      stderr: '',
    },
  });

  const result = await ctx.runCheck();

  expect(result.exitCode).toBe(0);
  expect(result.check?.ok).toBe(true);
});

test('it exits 2 when the gate reports an environment error', async () => {
  const body = `## Verification\n\n<!-- wringer:report -->\n<!-- wringer-data v2 {"version":2,"registry":"wringer","claims":[]} -->\n<!-- /wringer:report -->\n`;

  const ctx = await setupTest({
    gh: {
      exitCode: 0,
      stdout: JSON.stringify({ number: 142, baseRefName: 'main', body }),
      stderr: '',
    },
    gate: {
      exitCode: 4,
      stdout: JSON.stringify({
        ok: false,
        data: null,
        error: { code: 'environment', message: 'git is not installed' },
      }),
      stderr: '',
    },
  });

  const result = await ctx.runCheck();

  expect(result).toStrictEqual({
    exitCode: 2,
    check: null,
    error: 'the gate could not run: git is not installed',
  });
});

test('it exits 2 when the gate prints no envelope', async () => {
  const body = `## Verification\n\n<!-- wringer:report -->\n<!-- wringer-data v2 {"version":2,"registry":"wringer","claims":[]} -->\n<!-- /wringer:report -->\n`;

  const ctx = await setupTest({
    gh: {
      exitCode: 0,
      stdout: JSON.stringify({ number: 142, baseRefName: 'main', body }),
      stderr: '',
    },
    gate: { exitCode: 1, stdout: 'boom', stderr: '' },
  });

  const result = await ctx.runCheck();

  expect(result).toStrictEqual({
    exitCode: 2,
    check: null,
    error: 'the gate printed no JSON envelope',
  });
});
