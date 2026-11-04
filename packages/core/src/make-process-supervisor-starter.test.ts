import { expect, onTestFinished, test } from 'bun:test';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { waitFor } from '../test-utils/wait-for.ts';
import { buildRunPaths } from './build-state-paths.ts';
import { makeProcessSupervisorStarter } from './make-process-supervisor-starter.ts';

async function setupTest() {
  const root = await createTestFolder(import.meta.dir, 'supervisor-starter');

  onTestFinished(() => rm(root, { recursive: true, force: true }));

  return {
    makeStarter: (selfCommand: readonly string[]) =>
      makeProcessSupervisorStarter({ selfCommand, root, stateDir: '.wringer' }),
    readLog: async (runID: string) => {
      const text = await readFile(
        buildRunPaths(join(root, '.wringer'), runID).supervisorLog,
        'utf8',
      );

      return text === '' ? null : text;
    },
  };
}

test('it starts the command with the run and target, writing to the run log', async () => {
  const ctx = await setupTest();

  const starter = ctx.makeStarter(['sh', '-c', 'echo "$1 $2"']);

  await starter.start({ runID: 'mf3k2a-7q1z', target: 'box' });

  const log = await waitFor(() => ctx.readLog('mf3k2a-7q1z'));

  expect(log).toBe('mf3k2a-7q1z box\n');
});

test('it rejects with an environment error when the command cannot start', async () => {
  const ctx = await setupTest();

  const starter = ctx.makeStarter(['wringer-no-such-command']);

  expect(starter.start({ runID: 'mf3k2a-7q1z', target: 'box' })).rejects.toMatchObject({
    code: 'environment',
  });
});
