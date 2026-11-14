import { expect, onTestFinished, test } from 'bun:test';
import { once } from 'node:events';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { waitFor } from '@zgeoff/testing/helpers';
import invariant from 'tiny-invariant';
import { runGit } from '../change-facts/run-git.ts';
import { dispatch } from '../dispatch/dispatch.ts';
import { local } from '../host/local.ts';
import { createWringer } from '../registry/create-wringer.ts';
import { listenSupervisorSocket } from '../supervisor/listen-supervisor-socket.ts';
import { makeProcessSupervisorPort } from '../supervisor/make-process-supervisor-port.ts';
import { createShopWringer } from '../test-utils/create-shop-wringer.ts';
import { createTestSession } from '../test-utils/create-test-session.ts';

async function setupTest() {
  const wringer = createShopWringer();

  const shop = await createTestSession({ parent: import.meta.dir, wringer });

  // It closes each connection once the request arrives, as a supervisor that dies mid-call does.
  const brokenSocket = join(shop.repo.root, 'broken.sock');

  const broken = createServer((connection) => {
    connection.once('data', () => {
      connection.destroy();
    });
  });

  broken.listen(brokenSocket);

  onTestFinished(() => {
    broken.close();
  });

  await once(broken, 'listening');

  // A registry with one feature whose name a test can make hold the declared secret.
  const scoped = createWringer({ name: 'scoped' })
    .secret('SAMPLE_API_TOKEN')
    .target('local', {
      mode: 'launch',
      access: 'read-write',
      host: local(),
      launch: () => ({
        command: ['sh', '-c', `echo '{"event":"listening","port":4003}'; exec sleep 60`],
        ready: (line) => (line['event'] === 'listening' ? { web: 'http://127.0.0.1:4003' } : null),
      }),
    })
    .feature({
      name: 'verify-planted-scope-token',
      summary: 'Check a scope',
      paths: ['src/scope/**'],
    })
    .build();

  const stateDir = join(shop.repo.root, scoped.stateDir);

  // A command that writes nothing leaves no state folder, and the read below still finds it.
  await mkdir(stateDir, { recursive: true });

  return {
    root: shop.repo.root,
    state: shop.state,
    runScoped: (env: Readonly<Record<string, string>>, path: readonly string[]) =>
      dispatch(scoped, path, {}, { ...shop.session, env, target: 'local' }),

    // Every file under the state folder, joined.
    readStateFiles: async (): Promise<string> => {
      const names = await readdir(stateDir, { recursive: true, withFileTypes: true });

      const texts = await Promise.all(
        names
          .filter((entry) => entry.isFile())
          .map((entry) => readFile(join(entry.parentPath, entry.name), 'utf8')),
      );

      return texts.join('\n');
    },
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
    runWithClock: (target: string, path: readonly string[], now: () => Date) =>
      dispatch(wringer, path, {}, { ...shop.session, target, now }),
    runWithTimer: (
      target: string,
      path: readonly string[],
      timeoutMs: number,
      wait: (delayMs: number) => Promise<void>,
    ) => dispatch(wringer, path, {}, { ...shop.session, target, timeoutMs, wait }),

    // The supervisor's own stop goes to the socket that closes mid-call, while every other call
    // and the start reach the run's supervisor.
    runWithFailingStop: (
      target: string,
      path: readonly string[],
      timeoutMs: number,
      wait: (delayMs: number) => Promise<void>,
    ) =>
      dispatch(
        wringer,
        path,
        {},
        {
          ...shop.session,
          target,
          timeoutMs,
          wait,
          supervisor: {
            start: shop.session.supervisor.start,
            call: (call) => {
              const routed =
                call.request.method === 'stop' ? { ...call, socket: brokenSocket } : call;

              return shop.session.supervisor.call(routed);
            },
          },
        },
      ),
    waitForTargetLock: (target: string) =>
      shop.state.withTargetLock(target, () => Promise.resolve()),

    // The supervisor's command names no program on this machine, so its spawn fails.
    // The supervisor's command is a shell script, which exits at once as a supervisor that fails
    // before its run is ready does.
    runWithExitingSupervisor: (target: string, script: string) =>
      dispatch(
        wringer,
        ['up'],
        {},
        {
          ...shop.session,
          target,
          supervisor: makeProcessSupervisorPort({
            selfCommand: ['sh', '-c', script, 'supervisor'],
            root: shop.repo.root,
            stateDir: wringer.stateDir,
          }),
        },
      ),

    runWithMissingSupervisor: (target: string, path: readonly string[]) =>
      dispatch(
        wringer,
        path,
        {},
        {
          ...shop.session,
          target,
          supervisor: makeProcessSupervisorPort({
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

    return server.close(1000);
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

test('#up keeps the secrets file of the run it reuses', async () => {
  const ctx = await setupTest();
  const first = await ctx.run('local', ['up']);

  const runID = first.envelope.instance ?? '';

  await ctx.state.appendSecret(runID, { name: 'notes.session', value: 'planted-session-value' });
  await ctx.run('local', ['up']);

  const secrets = await ctx.state.readSecrets(runID);

  expect(secrets).toStrictEqual([{ name: 'notes.session', value: 'planted-session-value' }]);
});

test('#up --restart removes the secrets file of the run it ends', async () => {
  const ctx = await setupTest();
  const first = await ctx.run('local', ['up']);

  const runID = first.envelope.instance ?? '';

  await ctx.state.appendSecret(runID, { name: 'notes.session', value: 'planted-session-value' });
  await ctx.run('local', ['up'], { restart: true });

  const secrets = await ctx.state.readSecrets(runID);

  expect(secrets).toStrictEqual([]);
});

test('#up removes the secrets file of a run whose supervisor is gone', async () => {
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
  await ctx.state.appendSecret('gone-run', { name: 'notes.session', value: 'planted-gone-value' });
  await ctx.state.writePointers((current) => ({ ...current, currentRun: { local: 'gone-run' } }));
  await ctx.run('local', ['up']);

  const secrets = await ctx.state.readSecrets('gone-run');

  expect(secrets).toStrictEqual([]);
});

test('#up removes the secrets file of a crashed run it replaces', async () => {
  const ctx = await setupTest();

  await ctx.state.appendEvent('crashed-run', {
    type: 'run-started',
    at: '2026-11-04T10:00:00.000Z',
    target: 'local',
    mode: 'launch',
    fingerprint: 'empty',
  });

  await ctx.state.appendSecret('crashed-run', {
    name: 'notes.session',
    value: 'planted-crashed-value',
  });

  await ctx.state.appendEvent('crashed-run', {
    type: 'crashed',
    at: '2026-11-04T10:00:01.000Z',
    reason: 'the app exited',
  });

  await ctx.state.writePointers((current) => ({
    ...current,
    currentRun: { local: 'crashed-run' },
  }));

  await ctx.run('local', ['up']);

  const secrets = await ctx.state.readSecrets('crashed-run');

  expect(secrets).toStrictEqual([]);
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

  const answered = Promise.withResolvers<void>();

  // Each readiness wait lasts until `up` has answered with its timeout, so the deadline passes
  // after the run started and before `up` reads it ready, however long the start took.
  await ctx.runWithTimer('slow', ['up'], 1000, () => answered.promise);

  answered.resolve();

  const pointers = await ctx.state.readPointers();

  const runID = pointers.currentRun['slow'] ?? '';

  const status = await waitFor(async () => {
    const view = await ctx.state.readRun(runID);

    invariant(view?.status === 'ended' || view?.status === 'crashed', 'The run has not ended yet.');

    return view.status;
  });

  expect(status).toBe('ended');
});

test('#up gives up on readiness when its clock passes the ready timeout', async () => {
  const ctx = await setupTest();

  let nowMs = Date.parse('2026-03-01T09:00:00.000Z');

  onTestFinished(async () => {
    await ctx.run('slow', ['down']);
  });

  const result = await ctx.runWithClock('slow', ['up'], () => {
    nowMs += 60_000;

    return new Date(nowMs);
  });

  expect(result.envelope.error).toMatchObject({ code: 'timeout' });
});

test('#up waits between its readiness reads on the session timer', async () => {
  const ctx = await setupTest();

  onTestFinished(async () => {
    await ctx.run('slow', ['down']);
  });

  const waits: number[] = [];

  await ctx.runWithTimer('slow', ['up'], 10_000, (delayMs) => {
    waits.push(delayMs);

    return Promise.resolve();
  });

  expect(new Set(waits)).toStrictEqual(new Set([50]));
});

test('#up logs a failed stop of the run it abandoned at its deadline to the run', async () => {
  const ctx = await setupTest();

  onTestFinished(async () => {
    await ctx.run('slow', ['down']);
  });

  const answered = Promise.withResolvers<void>();

  // Each readiness wait lasts until `up` has answered with its timeout, so the run has started
  // when `up` abandons it.
  await ctx.runWithFailingStop('slow', ['up'], 1000, () => answered.promise);

  answered.resolve();

  const pointers = await ctx.state.readPointers();

  const events = await waitFor(async () => {
    const read = await ctx.state.readRunEvents(pointers.currentRun['slow'] ?? '');

    invariant(
      read.some((event) => event.type === 'late-failure' && event.code === 'environment'),
      'The late failure has not reached the run log yet.',
    );

    return read;
  });

  expect(events).toContainEqual({
    type: 'late-failure',
    at: expect.any(String),
    command: 'up',
    code: 'environment',
    message: 'The supervisor closed the socket.',
  });
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

test('#up keeps the secrets file of the run it would replace when its deadline passes while it reads the fingerprint', async () => {
  const ctx = await setupTest();

  const gate = Promise.withResolvers<undefined>();

  onTestFinished(() => {
    gate.resolve(undefined);
  });

  await ctx.state.appendEvent('crashed-run', {
    type: 'run-started',
    at: '2026-11-04T10:00:00.000Z',
    target: 'local',
    mode: 'launch',
    fingerprint: 'empty',
  });

  await ctx.state.appendSecret('crashed-run', {
    name: 'notes.session',
    value: 'planted-crashed-value',
  });

  await ctx.state.appendEvent('crashed-run', {
    type: 'crashed',
    at: '2026-11-04T10:00:01.000Z',
    reason: 'the app exited',
  });

  await ctx.state.writePointers((current) => ({
    ...current,
    currentRun: { local: 'crashed-run' },
  }));

  await ctx.runWithGatedFingerprint('local', 100, gate.promise);

  gate.resolve(undefined);

  await ctx.waitForTargetLock('local');

  const secrets = await ctx.state.readSecrets('crashed-run');

  expect(secrets).toStrictEqual([{ name: 'notes.session', value: 'planted-crashed-value' }]);
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

test.each([
  { name: 'an exit code', script: 'echo boom >&2; exit 7', reason: 'code 7' },
  { name: 'a signal', script: 'kill -KILL $$', reason: 'signal SIGKILL' },
  { name: 'a clean exit', script: 'exit 0', reason: 'code 0' },
])(
  '#up fails at once with an environment error when the supervisor exits with $name before its run is ready',
  async (row) => {
    const ctx = await setupTest();

    const started = Date.now();

    const result = await ctx.runWithExitingSupervisor('local', row.script);
    const view = await ctx.state.readRun(result.envelope.instance ?? '');

    expect({
      code: result.envelope.error?.code,
      message: result.envelope.error?.message,
      status: view?.status,
      quick: Date.now() - started < 3000,
    }).toStrictEqual({
      code: 'environment',
      message: expect.stringContaining(row.reason),
      status: 'crashed',
      quick: true,
    });
  },
);

test('#up refuses an attach target with a usage error naming attach', async () => {
  const ctx = await setupTest();
  const result = await ctx.run('prod', ['up']);

  expect(result.envelope.error).toStrictEqual({
    code: 'usage',
    message: 'Target prod is an attach target.',
    hint: 'Run `attach --target prod`.',
  });
});

test('#up refuses a registry whose feature name holds a declared secret, logging no copy of it', async () => {
  const ctx = await setupTest();
  const result = await ctx.runScoped({ SAMPLE_API_TOKEN: 'planted-scope-token' }, ['up']);
  const files = await ctx.readStateFiles();

  expect({
    code: result.envelope.error?.code,
    message: result.envelope.error?.message,
    instance: result.envelope.instance,
    leaked: files.includes('planted-scope-token'),
  }).toStrictEqual({
    code: 'usage',
    message: expect.stringContaining('holds the secret SAMPLE_API_TOKEN in its name'),
    instance: null,
    leaked: false,
  });
});

test('#up logs the feature names unchanged when none holds a secret', async () => {
  const ctx = await setupTest();
  const result = await ctx.runScoped({ SAMPLE_API_TOKEN: 'unrelated-sample-value' }, ['up']);
  const view = await ctx.state.readRun(result.envelope.instance ?? '');

  expect([...(view?.scopesRead?.keys() ?? [])]).toStrictEqual(['verify-planted-scope-token']);
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

    return server.close(1000);
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

test('#attach refuses an endpoint that holds URL credentials without printing them', async () => {
  const ctx = await setupTest();
  const result = await ctx.run('credentialed', ['attach']);

  expect({
    code: result.envelope.error?.code,
    message: result.envelope.error?.message,
    leaked: JSON.stringify(result.envelope).includes('planted-pass-word'),
  }).toStrictEqual({
    code: 'environment',
    message: expect.stringContaining('The endpoint web holds URL credentials.'),
    leaked: false,
  });
});
