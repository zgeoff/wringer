import { expect, onTestFinished, test } from 'bun:test';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { waitFor } from '@zgeoff/testing/helpers';
import invariant from 'tiny-invariant';
import { buildRunPaths } from '../state/build-state-paths.ts';
import { createTestFolder } from '../test-utils/create-test-folder.ts';
import { makeProcessSupervisorPort } from './make-process-supervisor-port.ts';

async function setupTest() {
  const root = await createTestFolder(import.meta.dir, 'supervisor-port');

  onTestFinished(() => rm(root, { recursive: true, force: true }));

  return {
    makePort: (selfCommand: readonly string[]) =>
      makeProcessSupervisorPort({ selfCommand, root, stateDir: '.wringer' }),
    readLog: (runID: string) =>
      readFile(buildRunPaths(join(root, '.wringer'), runID).supervisorLog, 'utf8'),
  };
}

test('it starts the command with the run and target, writing to the run log', async () => {
  const ctx = await setupTest();

  const port = ctx.makePort(['sh', '-c', 'echo "$1 $2"']);

  await port.start({ runID: 'mf3k2a-7q1z', target: 'box' });

  const log = await waitFor(async () => {
    const text = await ctx.readLog('mf3k2a-7q1z');

    invariant(text !== '', 'The run log is still empty.');

    return text;
  });

  expect(log).toBe('mf3k2a-7q1z box\n');
});

test('it rejects with an environment error when the command cannot start', async () => {
  const ctx = await setupTest();

  const port = ctx.makePort(['wringer-no-such-command']);

  expect(port.start({ runID: 'mf3k2a-7q1z', target: 'box' })).rejects.toMatchObject({
    code: 'environment',
  });
});

test.each([
  { name: 'its exit code', script: 'exit 7', exit: { code: 7, signal: null } },
  { name: 'its signal', script: 'kill -KILL $$', exit: { code: null, signal: 'SIGKILL' } },
])('it resolves $name once the command exits', async (row) => {
  const ctx = await setupTest();

  const port = ctx.makePort(['sh', '-c', row.script, 'supervisor']);

  await port.start({ runID: 'mf3k2a-7q1z', target: 'box' });

  const exit = await port.watchExit?.('mf3k2a-7q1z');

  expect(exit).toStrictEqual(row.exit);
});
