import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { waitFor } from '@zgeoff/testing';
import { createTempDir } from '@zgeoff/testing/fs';
import invariant from 'tiny-invariant';
import { buildRunPaths } from '../state/build-state-paths.ts';
import { makeProcessSupervisorPort } from './make-process-supervisor-port.ts';

function setupTest() {
  const root = createTempDir('supervisor-port').path;

  return {
    makePort: (selfCommand: readonly string[]) =>
      makeProcessSupervisorPort({ selfCommand, root, stateDir: '.wringer' }),
    readLog: (runID: string) =>
      readFile(buildRunPaths(join(root, '.wringer'), runID).supervisorLog, 'utf8'),
  };
}

test('it starts the command with the run and target, writing to the run log', async () => {
  const ctx = setupTest();
  const port = ctx.makePort(['sh', '-c', 'echo "$1 $2"']);

  await port.start({ runID: 'mf3k2a-7q1z', target: 'box' });

  const log = await waitFor(async () => {
    const text = await ctx.readLog('mf3k2a-7q1z');

    invariant(text !== '', 'The run log is still empty.');

    return text;
  });

  expect(log).toBe('mf3k2a-7q1z box\n');
});

test('it rejects with an environment error when the command cannot start', () => {
  const ctx = setupTest();
  const port = ctx.makePort(['wringer-no-such-command']);

  expect(port.start({ runID: 'mf3k2a-7q1z', target: 'box' })).rejects.toMatchObject({
    code: 'environment',
  });
});

test.each([
  { name: 'its exit code', script: 'exit 7', exit: { code: 7, signal: null } },
  { name: 'its signal', script: 'kill -KILL $$', exit: { code: null, signal: 'SIGKILL' } },
])('it resolves $name once the command exits', async (row) => {
  const ctx = setupTest();
  const port = ctx.makePort(['sh', '-c', row.script, 'supervisor']);

  await port.start({ runID: 'mf3k2a-7q1z', target: 'box' });

  const exit = await port.watchExit?.('mf3k2a-7q1z');

  expect(exit).toStrictEqual(row.exit);
});
