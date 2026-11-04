import { expect, onTestFinished, test } from 'bun:test';
import { join } from 'node:path';
import { createRepoState, envelopeSchema, makeProcessSupervisorStarter } from '@wringer/core';
import { parsePublishedEnvelope } from '../../../test-utils/parse-published-envelope.ts';
import { createTestRepo } from '../../core/test-utils/create-test-repo.ts';
import { createDemoWringer } from '../test-utils/create-demo-wringer.ts';
import { readRepoRoot } from './read-repo-root.ts';
import { runCLI } from './run-cli.ts';

async function setupTest() {
  const repo = await createTestRepo(import.meta.dir);

  onTestFinished(() => repo.remove());

  const wringer = createDemoWringer();
  const written: string[] = [];
  const selfCommand = [process.execPath, join(import.meta.dir, '..', 'test-utils', 'demo-cli.ts')];

  const run = async (argv: readonly string[], cwd = repo.root) => {
    const exitCode = await runCLI(wringer, {
      argv,
      cwd,
      isTTY: false,
      isAgent: false,
      writeStdout: (text) => {
        written.push(text);
      },
      readRepoRoot,
      openRepo: (root) => ({
        state: createRepoState(root, wringer.stateDir),
        supervisor: makeProcessSupervisorStarter({ selfCommand, root, stateDir: wringer.stateDir }),
      }),
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

  const envelope = ctx.parseEnvelope(result.stdout);

  expect({ exitCode: result.exitCode, feature: envelope.data }).toStrictEqual({
    exitCode: 0,
    feature: { target: null, feature: 'greeting', cursors: {} },
  });
});

test('it assigns the words after the command to its positionals in order', async () => {
  const ctx = await setupTest();
  const result = await ctx.run(['label', 'shelf-a', 'apple', '--label', 'ripe']);

  const envelope = ctx.parseEnvelope(result.stdout);

  expect({ exitCode: result.exitCode, data: envelope.data }).toStrictEqual({
    exitCode: 0,
    data: { shelf: 'shelf-a', item: 'apple', label: 'ripe' },
  });
});

test('it passes an empty string flag to the command as an empty string', async () => {
  const ctx = await setupTest();
  const result = await ctx.run(['label', 'shelf-a', 'apple', '--label', '']);

  const envelope = ctx.parseEnvelope(result.stdout);

  expect(envelope.data).toStrictEqual({ shelf: 'shelf-a', item: 'apple', label: '' });
});

test('it names only the command in a failure envelope, never its argument values', async () => {
  const ctx = await setupTest();
  const result = await ctx.run(['label', 'shelf-a', 'secret-item', '--colour', 'red']);

  const envelope = ctx.parseEnvelope(result.stdout);

  expect({ command: envelope.command, code: envelope.error?.code }).toStrictEqual({
    command: 'label',
    code: 'usage',
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

  const envelope = ctx.parseEnvelope(result.stdout);

  expect({
    exitCode: result.exitCode,
    ok: envelope.ok,
    code: envelope.error?.code,
    message: envelope.error?.message,
  }).toStrictEqual({
    exitCode: 2,
    ok: false,
    code: 'usage',
    message: expect.stringContaining(message),
  });
});

test('it answers a missing required argument with a usage envelope from the schema', async () => {
  const ctx = await setupTest();
  const result = await ctx.run(['gate', '--base', 'main']);

  const envelope = ctx.parseEnvelope(result.stdout);

  expect({
    exitCode: result.exitCode,
    code: envelope.error?.code,
    message: envelope.error?.message,
  }).toStrictEqual({
    exitCode: 2,
    code: 'usage',
    message: expect.stringContaining('bodyFile'),
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

  const envelope = ctx.parseEnvelope(result.stdout);

  expect({ target: envelope.target, data: envelope.data }).toStrictEqual({
    target: 'prod',
    data: expect.objectContaining({ access: 'read-only' }),
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
