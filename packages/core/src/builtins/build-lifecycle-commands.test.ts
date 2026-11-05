import { expect, onTestFinished, test } from 'bun:test';
import { join } from 'node:path';
import { createShopWringer } from '../../test-utils/create-shop-wringer.ts';
import { createTestSession } from '../../test-utils/create-test-session.ts';
import { waitFor } from '../../test-utils/wait-for.ts';
import { dispatch } from '../dispatch.ts';
import { listenSupervisorSocket } from '../listen-supervisor-socket.ts';
import { makeProcessSupervisorStarter } from '../make-process-supervisor-starter.ts';
import { runGit } from '../run-git.ts';

async function setupTest() {
  const wringer = createShopWringer();

  const shop = await createTestSession({ parent: import.meta.dir, wringer });

  return {
    root: shop.repo.root,
    state: shop.state,
    run: (target: string, path: readonly string[], args: unknown = {}) =>
      dispatch(wringer, path, args, { ...shop.session, target }),
    runWithin: (target: string, path: readonly string[], timeoutMs: number) =>
      dispatch(wringer, path, {}, { ...shop.session, target, timeoutMs }),

    // The fingerprint read's first git call, `merge-base`, waits for `gate`, so the deadline passes
    // mid-read. The envelope's SHA read never waits.
    runWithGatedFingerprint: (target: string, timeoutMs: number, gate: Promise<unknown>) => {
      const gitGates: Readonly<Record<string, Promise<unknown>>> = { 'merge-base': gate };

      return dispatch(
        wringer,
        ['up'],
        {},
        {
          ...shop.session,
          target,
          timeoutMs,
          repoHost: {
            ...shop.session.repoHost,
            runGit: async (request) => {
              await gitGates[request.args[0] ?? ''];

              return runGit(request);
            },
          },
        },
      );
    },
    waitForTargetLock: (target: string) =>
      shop.state.withTargetLock(target, () => Promise.resolve()),

    // The supervisor's command names no program on this machine, so its spawn fails.
    runWithMissingSupervisor: (target: string, path: readonly string[]) =>
      dispatch(
        wringer,
        path,
        {},
        {
          ...shop.session,
          target,
          supervisor: makeProcessSupervisorStarter({
            selfCommand: [join(shop.repo.root, 'no-such-cli')],
            root: shop.repo.root,
            stateDir: wringer.stateDir,
          }),
        },
      ),
  };
}

test('#up reuses the running run of a target, keeping its doctor pass', async () => {
  const ctx = await setupTest();
  const first = await ctx.run('local', ['up']);

  await ctx.run('local', ['doctor']);

  const second = await ctx.run('local', ['up']);
  const reused = await ctx.state.readRun(first.envelope.instance ?? '');

  expect({ data: second.envelope.data, doctor: reused?.doctor }).toStrictEqual({
    data: {
      run: first.envelope.instance,
      target: 'local',
      status: 'running',
      endpoints: { web: 'http://127.0.0.1:4000' },
      services: ['notes/store'],
      reused: true,
    },
    doctor: 'passed',
  });
});

test('#up keeps a live run and its pointer when its supervisor answers the ping too late', async () => {
  const ctx = await setupTest();

  const socket = join(ctx.root, 'late.sock');
  const answer = Promise.withResolvers<null>();
  const transportErrors: unknown[] = [];

  const server = await listenSupervisorSocket({
    path: socket,
    answerRequest: () => answer.promise,
    onTransportError: (error) => {
      transportErrors.push(error);
    },
  });

  onTestFinished(() => {
    answer.resolve(null);
    server.close();
  });

  await ctx.state.appendEvent('late-run', {
    type: 'run-started',
    at: '2026-11-04T10:00:00.000Z',
    target: 'local',
    mode: 'launch',
    fingerprint: 'empty',
  });

  await ctx.state.appendEvent('late-run', {
    type: 'supervisor-ready',
    at: '2026-11-04T10:00:01.000Z',
    pid: process.pid,
    socket,
  });

  await ctx.state.appendEvent('late-run', { type: 'run-ready', at: '2026-11-04T10:00:02.000Z' });
  await ctx.state.writePointers((current) => ({ ...current, currentRun: { local: 'late-run' } }));

  const result = await ctx.runWithin('local', ['up'], 100);

  await ctx.state.withTargetLock('local', () => Promise.resolve(null));

  const [view, pointers] = await Promise.all([
    ctx.state.readRun('late-run'),
    ctx.state.readPointers(),
  ]);

  expect({
    code: result.envelope.error?.code,
    status: view?.status,
    currentRun: pointers.currentRun,
  }).toStrictEqual({
    code: 'timeout',
    status: 'running',
    currentRun: { local: 'late-run' },
  });
});

test('#up --restart ends the current run and starts a new one', async () => {
  const ctx = await setupTest();
  const first = await ctx.run('local', ['up']);
  const second = await ctx.run('local', ['up'], { restart: true });
  const old = await ctx.state.readRun(first.envelope.instance ?? '');

  expect({
    fresh: second.envelope.instance !== first.envelope.instance,
    old: old?.status,
  }).toStrictEqual({
    fresh: true,
    old: 'ended',
  });
});

test('#up marks a run whose supervisor is gone as crashed, then starts a new run', async () => {
  const ctx = await setupTest();

  await ctx.state.appendEvent('gone-run', {
    type: 'run-started',
    at: '2026-11-04T10:00:00.000Z',
    target: 'local',
    mode: 'launch',
    fingerprint: 'empty',
  });

  await ctx.state.appendEvent('gone-run', {
    type: 'supervisor-ready',
    at: '2026-11-04T10:00:01.000Z',
    pid: 1,
    socket: '/nonexistent/wringer.sock',
  });

  await ctx.state.appendEvent('gone-run', { type: 'run-ready', at: '2026-11-04T10:00:02.000Z' });
  await ctx.state.writePointers((current) => ({ ...current, currentRun: { local: 'gone-run' } }));
  await ctx.run('local', ['up']);

  const old = await ctx.state.readRun('gone-run');

  expect(old?.status).toBe('crashed');
});

test('#up fails with an environment error when the app exits before it is ready', async () => {
  const ctx = await setupTest();
  const result = await ctx.run('broken', ['up']);

  expect({
    exitCode: result.exitCode,
    code: result.envelope.error?.code,
    message: result.envelope.error?.message,
  }).toStrictEqual({
    exitCode: 4,
    code: 'environment',
    message: expect.stringContaining('exited with code 3'),
  });
});

test('#up stops a run that becomes ready only after the command missed its deadline', async () => {
  const ctx = await setupTest();

  await ctx.runWithin('slow', ['up'], 100);

  const pointers = await ctx.state.readPointers();

  const runID = pointers.currentRun['slow'] ?? '';

  const status = await waitFor(async () => {
    const view = await ctx.state.readRun(runID);

    return view?.status === 'ended' || view?.status === 'crashed' ? view.status : null;
  });

  expect(status).toBe('ended');
});

test('#up starts no run when its deadline passes while it reads the fingerprint', async () => {
  const ctx = await setupTest();

  const gate = Promise.withResolvers<undefined>();

  onTestFinished(() => {
    gate.resolve(undefined);
  });

  await ctx.runWithGatedFingerprint('local', 100, gate.promise);

  gate.resolve(undefined);

  await ctx.waitForTargetLock('local');

  const pointers = await ctx.state.readPointers();

  expect(pointers.currentRun['local']).toBeUndefined();
});

test('#up marks the new run crashed when its supervisor cannot start', async () => {
  const ctx = await setupTest();
  const result = await ctx.runWithMissingSupervisor('local', ['up']);
  const view = await ctx.state.readRun(result.envelope.instance ?? '');

  expect({ code: result.envelope.error?.code, status: view?.status }).toStrictEqual({
    code: 'environment',
    status: 'crashed',
  });
});

test('#up refuses an attach target with a usage error naming attach', async () => {
  const ctx = await setupTest();
  const result = await ctx.run('prod', ['up']);

  expect(result.envelope.error).toStrictEqual({
    code: 'usage',
    message: 'Target prod is an attach target.',
    hint: 'Run `attach --target prod`.',
  });
});

test('#down stops the run, ends its log and clears the pointer', async () => {
  const ctx = await setupTest();
  const up = await ctx.run('local', ['up']);

  await ctx.run('local', ['down']);

  const [view, pointers] = await Promise.all([
    ctx.state.readRun(up.envelope.instance ?? ''),
    ctx.state.readPointers(),
  ]);

  expect({ status: view?.status, currentRun: pointers.currentRun }).toStrictEqual({
    status: 'ended',
    currentRun: {},
  });
});

test('#down marks a run whose supervisor is gone as crashed and clears the pointer', async () => {
  const ctx = await setupTest();

  await ctx.state.appendEvent('gone-run', {
    type: 'run-started',
    at: '2026-11-04T10:00:00.000Z',
    target: 'local',
    mode: 'launch',
    fingerprint: 'empty',
  });

  await ctx.state.appendEvent('gone-run', {
    type: 'supervisor-ready',
    at: '2026-11-04T10:00:01.000Z',
    pid: 1,
    socket: '/nonexistent/wringer.sock',
  });

  await ctx.state.appendEvent('gone-run', { type: 'run-ready', at: '2026-11-04T10:00:02.000Z' });
  await ctx.state.writePointers((current) => ({ ...current, currentRun: { local: 'gone-run' } }));

  const result = await ctx.run('local', ['down']);

  const [view, pointers] = await Promise.all([
    ctx.state.readRun('gone-run'),
    ctx.state.readPointers(),
  ]);

  expect({
    data: result.envelope.data,
    status: view?.status,
    currentRun: pointers.currentRun,
  }).toStrictEqual({
    data: { run: 'gone-run', stopped: false },
    status: 'crashed',
    currentRun: {},
  });
});

test('#down keeps a live run and its pointer when its supervisor answers too late', async () => {
  const ctx = await setupTest();

  const socket = join(ctx.root, 'late.sock');
  const answer = Promise.withResolvers<null>();
  const transportErrors: unknown[] = [];

  const server = await listenSupervisorSocket({
    path: socket,
    answerRequest: () => answer.promise,
    onTransportError: (error) => {
      transportErrors.push(error);
    },
  });

  onTestFinished(() => {
    answer.resolve(null);
    server.close();
  });

  await ctx.state.appendEvent('late-run', {
    type: 'run-started',
    at: '2026-11-04T10:00:00.000Z',
    target: 'local',
    mode: 'launch',
    fingerprint: 'empty',
  });

  await ctx.state.appendEvent('late-run', {
    type: 'supervisor-ready',
    at: '2026-11-04T10:00:01.000Z',
    pid: process.pid,
    socket,
  });

  await ctx.state.appendEvent('late-run', { type: 'run-ready', at: '2026-11-04T10:00:02.000Z' });
  await ctx.state.writePointers((current) => ({ ...current, currentRun: { local: 'late-run' } }));

  const result = await ctx.runWithin('local', ['down'], 100);

  await ctx.state.withTargetLock('local', () => Promise.resolve(null));

  const [view, pointers] = await Promise.all([
    ctx.state.readRun('late-run'),
    ctx.state.readPointers(),
  ]);

  expect({
    code: result.envelope.error?.code,
    status: view?.status,
    currentRun: pointers.currentRun,
  }).toStrictEqual({
    code: 'timeout',
    status: 'running',
    currentRun: { local: 'late-run' },
  });
});

test('#down on a target with no run reports that it stopped nothing', async () => {
  const ctx = await setupTest();
  const result = await ctx.run('local', ['down']);

  expect(result.envelope.data).toStrictEqual({ run: null, stopped: false });
});

test('#detach ends the run of an attach target', async () => {
  const ctx = await setupTest();
  const attach = await ctx.run('prod', ['attach']);

  await ctx.run('prod', ['detach']);

  const view = await ctx.state.readRun(attach.envelope.instance ?? '');

  expect(view?.status).toBe('ended');
});
