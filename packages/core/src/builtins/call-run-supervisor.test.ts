import { expect, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestFolder } from '../../../../test-utils/create-test-folder.ts';
import { buildMockRunView } from '../../test-utils/build-mock-run-view.ts';
import type { RunView } from '../build-run-view.ts';
import { listenSupervisorSocket } from '../listen-supervisor-socket.ts';
import { makeProcessSupervisorPort } from '../make-process-supervisor-port.ts';
import { WringerError } from '../wringer-error.ts';
import { callRunSupervisor, isSupervisorGone } from './call-run-supervisor.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'call-run-supervisor');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const supervisor = makeProcessSupervisorPort({
    selfCommand: ['true'],
    root: directory,
    stateDir: '.wringer',
  });

  return {
    socket: join(directory, 'supervisor.sock'),
    callRunSupervisor: (run: RunView, signal: AbortSignal) =>
      callRunSupervisor(supervisor, run, 'ping', signal),
  };
}

test.each([
  { name: 'a refused connection', error: new WringerError('not-running'), gone: true },
  { name: 'a call past its deadline', error: new WringerError('timeout'), gone: false },
  { name: 'a closed socket', error: new WringerError('environment'), gone: false },
  { name: 'a plain error', error: new Error('The store kept its lock.'), gone: false },
])('#isSupervisorGone reads $name as a gone supervisor: $gone', (row) => {
  expect(isSupervisorGone(row.error)).toBe(row.gone);
});

test('it reads a run that never got a supervisor as gone', async () => {
  const ctx = await setupTest();

  const reach = await ctx.callRunSupervisor(
    buildMockRunView({ supervisor: null }),
    new AbortController().signal,
  );

  expect(reach).toBe('gone');
});

test('it reads a socket that nothing listens on as gone', async () => {
  const ctx = await setupTest();

  const reach = await ctx.callRunSupervisor(
    buildMockRunView({ supervisor: { pid: 1, socket: ctx.socket } }),
    new AbortController().signal,
  );

  expect(reach).toBe('gone');
});

test('it rejects a call that a live supervisor answers too late', async () => {
  const ctx = await setupTest();

  const answer = Promise.withResolvers<null>();
  const transportErrors: unknown[] = [];

  const server = await listenSupervisorSocket({
    path: ctx.socket,
    answerRequest: () => answer.promise,
    onTransportError: (error) => {
      transportErrors.push(error);
    },
  });

  onTestFinished(() => {
    answer.resolve(null);
    server.close();
  });

  const calling = ctx.callRunSupervisor(
    buildMockRunView({ supervisor: { pid: process.pid, socket: ctx.socket } }),
    AbortSignal.timeout(50),
  );

  expect(calling).rejects.toMatchObject({ code: 'timeout' });
});
