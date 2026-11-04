import { expect, onTestFinished, test } from 'bun:test';
import { join } from 'node:path';
import { envelopeSchema } from '@wringer/core';
import { parsePublishedEnvelope } from '../../../test-utils/parse-published-envelope.ts';
import { createTestRepo } from '../../core/test-utils/create-test-repo.ts';
import { createDemoWringer } from '../test-utils/create-demo-wringer.ts';
import { runCLI } from './run-cli.ts';

async function setupTest() {
  const repo = await createTestRepo(import.meta.dir);

  onTestFinished(() => repo.remove());

  const wringer = createDemoWringer();
  const written: string[] = [];

  const run = async (argv: readonly string[], cwd = repo.root) => {
    const exitCode = await runCLI(wringer, {
      argv,
      cwd,
      isTTY: false,
      isAgent: false,
      selfCommand: [process.execPath, join(import.meta.dir, '..', 'test-utils', 'demo-cli.ts')],
      writeStdout: (text) => {
        written.push(text);
      },
    });

    return { exitCode, stdout: written.splice(0).join('') };
  };

  return {
    root: repo.root,
    run,
    parseEnvelope: (text: string) => envelopeSchema.parse(JSON.parse(text)),
  };
}

test('it prints one JSON envelope that parses against the published schema', async () => {
  const ctx = await setupTest();
  const result = await ctx.run(['status']);

  expect({ exitCode: result.exitCode, check: parsePublishedEnvelope(result.stdout) }).toStrictEqual(
    { exitCode: 0, check: { valid: true, errors: [] } },
  );
});

test('it passes the flags a command declares to the command', async () => {
  const ctx = await setupTest();
  const result = await ctx.run(['use', '--feature', 'greeting']);

  expect({ exitCode: result.exitCode, envelope: ctx.parseEnvelope(result.stdout) }).toMatchObject({
    exitCode: 0,
    envelope: { ok: true, data: { feature: 'greeting' } },
  });
});

test.each([
  ['an unknown flag', ['status', '--colour', 'red'], 'Unknown option: --colour'],
  ['an unknown command', ['teleport'], 'Command not found: teleport'],
  [
    'a flag of the wrong type',
    ['action', 'greet', '--name', 'Ines', '--times', 'two'],
    'should be',
  ],
  ['no command', [], 'Name a command.'],
  ['a word the command takes no argument for', ['down', 'prod'], 'takes no argument `prod`'],
])('it answers %s with a usage envelope and exit code 2', async (_name, argv, message) => {
  const ctx = await setupTest();
  const result = await ctx.run(argv);

  expect({ exitCode: result.exitCode, envelope: ctx.parseEnvelope(result.stdout) }).toMatchObject({
    exitCode: 2,
    envelope: { ok: false, error: { code: 'usage', message: expect.stringContaining(message) } },
  });
});

test('it answers a missing required argument with a usage envelope from the schema', async () => {
  const ctx = await setupTest();
  const result = await ctx.run(['gate', '--base', 'main']);

  expect({ exitCode: result.exitCode, envelope: ctx.parseEnvelope(result.stdout) }).toMatchObject({
    exitCode: 2,
    envelope: { error: { code: 'usage', message: expect.stringContaining('bodyFile') } },
  });
});

test('it prints text for a person with --human', async () => {
  const ctx = await setupTest();
  const result = await ctx.run(['use', '--feature', 'greeting', '--human']);

  expect(result.stdout).toStartWith('use passed\n{\n  "target": null,\n  "feature": "greeting",');
});

test('it prints the error and its hint for a person with --human', async () => {
  const ctx = await setupTest();
  const result = await ctx.run(['action', 'greet', '--name', 'Ines', '--human']);

  expect(result.stdout).toBe(
    'action.greet failed (not-running): Target local has no running run.\nhint: Run `up --target local` first.\n',
  );
});

test('it marks each command in the help as a read or a write', async () => {
  const ctx = await setupTest();
  const result = await ctx.run(['action', '--help']);

  expect(result.stdout).toContain('Greet someone [read]');
});

test('it runs a command against the target --target names', async () => {
  const ctx = await setupTest();
  const result = await ctx.run(['status', '--target', 'prod']);

  expect(ctx.parseEnvelope(result.stdout)).toMatchObject({
    target: 'prod',
    data: { access: 'read-only' },
  });
});

test('it answers outside a git worktree with an environment envelope and exit code 4', async () => {
  const ctx = await setupTest();
  const result = await ctx.run(['status'], '/');

  expect({
    exitCode: result.exitCode,
    code: ctx.parseEnvelope(result.stdout).error?.code,
  }).toStrictEqual({
    exitCode: 4,
    code: 'environment',
  });
});
