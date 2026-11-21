import { expect, onTestFinished, test } from 'bun:test';
import { join } from 'node:path';
import { createTempDir } from '@zgeoff/testing/fs';
import type { RunView } from '../state/build-run-view.ts';
import { listenSupervisorSocket } from '../supervisor/listen-supervisor-socket.ts';
import { makeProcessSupervisorPort } from '../supervisor/make-process-supervisor-port.ts';
import { buildMockRunView } from '../test-utils/build-mock-run-view.ts';
import { WringerError } from '../wringer-error.ts';
import { callRunSupervisor, isSupervisorGone } from './call-run-supervisor.ts';

function setupTest() {
  const directory = createTempDir('call-run-supervisor').path;

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
  const ctx = setupTest();

  const reach = await ctx.callRunSupervisor(
    buildMockRunView({ supervisor: null }),
    new AbortController().signal,
  );

  expect(reach).toBe('gone');
});

test('it reads a socket that nothing listens on as gone', async () => {
  const ctx = setupTest();

  const reach = await ctx.callRunSupervisor(
    buildMockRunView({ supervisor: { pid: 1, socket: ctx.socket } }),
    new AbortController().signal,
  );

  expect(reach).toBe('gone');
});

test('it rejects a call that a live supervisor answers too late', async () => {
  const ctx = setupTest();
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

    return server.close(1000);
  });

  const calling = ctx.callRunSupervisor(
    buildMockRunView({ supervisor: { pid: process.pid, socket: ctx.socket } }),
    AbortSignal.timeout(50),
  );

  expect(calling).rejects.toMatchObject({ code: 'timeout' });
});
