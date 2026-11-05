import { expect, onTestFinished, test } from 'bun:test';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '../../../test-utils/create-test-folder.ts';
import { waitFor } from '../test-utils/wait-for.ts';
import { buildRunPaths } from './build-state-paths.ts';
import { makeProcessSupervisorPort } from './make-process-supervisor-port.ts';

async function setupTest() {
  const root = await createTestFolder(import.meta.dir, 'supervisor-port');

  onTestFinished(() => rm(root, { recursive: true, force: true }));

  return {
    makePort: (selfCommand: readonly string[]) =>
      makeProcessSupervisorPort({ selfCommand, root, stateDir: '.wringer' }),
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

  const port = ctx.makePort(['sh', '-c', 'echo "$1 $2"']);

  await port.start({ runID: 'mf3k2a-7q1z', target: 'box' });

  const log = await waitFor(() => ctx.readLog('mf3k2a-7q1z'));

  expect(log).toBe('mf3k2a-7q1z box\n');
});

test('it rejects with an environment error when the command cannot start', async () => {
  const ctx = await setupTest();

  const port = ctx.makePort(['wringer-no-such-command']);

  expect(port.start({ runID: 'mf3k2a-7q1z', target: 'box' })).rejects.toMatchObject({
    code: 'environment',
  });
});
