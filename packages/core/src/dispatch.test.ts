import { expect, mock, onTestFinished, test } from 'bun:test';
import { once } from 'node:events';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { callSupervisor } from './call-supervisor.ts';
import { dispatch } from './dispatch.ts';
import { removeDirectory } from './remove-directory.ts';
import { runGit } from './run-git.ts';
import { createShopWringer } from './test-utils/create-shop-wringer.ts';
import { createTestSession } from './test-utils/create-test-session.ts';
import { parsePublishedEnvelope } from './test-utils/parse-published-envelope.ts';
import { WringerError } from './wringer-error.ts';
import { writeNewFile } from './write-new-file.ts';

async function setupTest() {
  const wringer = createShopWringer();

  const shop = await createTestSession({
    parent: import.meta.dir,
    wringer,
    env: { SHOP_API_TOKEN: 'planted-shop-token' },
  });

  const stateDir = join(shop.repo.root, wringer.stateDir);
  const gate = Promise.withResolvers<undefined>();
  const guardsDone = Promise.withResolvers<undefined>();

  onTestFinished(() => {
    gate.resolve(undefined);
  });

  const evidenceWrites = mock(writeNewFile);
  const supervisorCalls = mock(callSupervisor);
  const order: string[] = [];
  const gitGates: Readonly<Record<string, Promise<unknown>>> = { 'merge-base': gate.promise };

  return {
    // Every file wringer keeps for an upload or a report: the run's features folders and logs, the
    // payloads and the late failures. The app's own log and the secrets file stay out.
    readSinks: async (): Promise<string> => {
      const names = await readdir(stateDir, { recursive: true });

      const sinks = names.filter(
        (name) =>
          /(?:^|\/)features\//u.test(name) ||
          name.endsWith('/log.ndjson') ||
          name.startsWith('payloads/') ||
          name === 'late-failures.ndjson',
      );

      const texts = await Promise.all(
        sinks.map(async (name) => {
          const info = await stat(join(stateDir, name));

          return info.isFile() ? readFile(join(stateDir, name), 'utf8') : '';
        }),
      );

      return texts.join('\n');
    },
    readSecretsFile: (runID: string) =>
      readFile(join(stateDir, 'runs', runID, 'secrets.ndjson'), 'utf8'),
    statSecretsFile: (runID: string) => stat(join(stateDir, 'runs', runID, 'secrets.ndjson')),
    root: shop.repo.root,
    runWithEnv: (
      env: Readonly<Record<string, string>>,
      target: string,
      path: readonly string[],
      args: unknown = {},
    ) => dispatch(wringer, path, args, { ...shop.session, env, target }),
    evidenceWrites,
    supervisorCalls,
    runRecordingCalls: (path: readonly string[]) =>
      dispatch(
        wringer,
        path,
        {},
        {
          ...shop.session,
          target: 'local',
          supervisor: { ...shop.session.supervisor, call: supervisorCalls },
        },
      ),

    order,

    // Each service call settles 300 ms after the command's 50 ms deadline, as a browser does once it
    // has closed the page of a cancelled action.
    runWithSlowCancel: (
      path: readonly string[],
      cancelFailure = new WringerError('timeout', { message: 'The page closed.' }),
      earlyFailures: WringerError[] = [],
    ) =>
      dispatch(
        wringer,
        path,
        {},
        {
          ...shop.session,
          target: 'local',
          timeoutMs: 50,
          supervisor: {
            ...shop.session.supervisor,

            // Each early failure answers one call at once, before the deadline.
            call: async (call) => {
              const early = earlyFailures.shift();

              if (early !== undefined) {
                throw early;
              }

              await once(call.signal, 'abort');
              await once(AbortSignal.timeout(300), 'abort');

              order.push('call settled');
              throw cancelFailure;
            },
          },
        },
      ),
    runRecordingWrites: (path: readonly string[]) =>
      dispatch(
        wringer,
        path,
        {},
        {
          ...shop.session,
          target: 'local',
          repoHost: { ...shop.session.repoHost, writeNewFile: evidenceWrites },
        },
      ),
    lines: shop.lines,
    state: shop.state,
    run: (target: string, path: readonly string[], args: unknown = {}) =>
      dispatch(wringer, path, args, { ...shop.session, target }),
    runWithin: (timeoutMs: number, path: readonly string[], args: unknown) =>
      dispatch(wringer, path, args, { ...shop.session, target: 'local', timeoutMs }),

    // The guards' fingerprint read waits for the gate at its first step, `merge-base`, and its last
    // step, removing the temporary index, settles `guardsDone`. The envelope's SHA read never waits.
    runWithGatedGuards: (timeoutMs: number, path: readonly string[]) =>
      dispatch(
        wringer,
        path,
        {},
        {
          ...shop.session,
          target: 'local',
          timeoutMs,
          repoHost: {
            ...shop.session.repoHost,
            runGit: async (request) => {
              await gitGates[request.args[0] ?? ''];

              return runGit(request);
            },
            removeDirectory: async (directory) => {
              await removeDirectory(directory);

              guardsDone.resolve(undefined);
            },
          },
        },
      ),
    openGate: () => {
      gate.resolve(undefined);
    },
    guardsDone: guardsDone.promise,
    runOnPointers: (path: readonly string[], args: unknown = {}) =>
      dispatch(wringer, path, args, shop.session),
    runAsFeature: (feature: string, path: readonly string[], args: unknown) =>
      dispatch(wringer, path, args, { ...shop.session, target: 'local', feature }),
  };
}

test('it answers an unknown command with a usage error and exit code 2', async () => {
  const ctx = await setupTest();
  const result = await ctx.run('local', ['teleport']);

  expect({ exitCode: result.exitCode, error: result.envelope.error }).toStrictEqual({
    exitCode: 2,
    error: { code: 'usage', message: 'There is no command `teleport`.', hint: null },
  });
});

test('it writes a command evidence through the session repo host', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);
  await ctx.runRecordingWrites(['action', 'receipt']);

  expect(ctx.evidenceWrites.mock.calls.map(([path]) => path)).toStrictEqual([
    expect.stringMatching(/-receipt\.txt$/u),
  ]);
});

test('it answers arguments that fail the schema with a usage error', async () => {
  const ctx = await setupTest();
  const result = await ctx.run('local', ['use'], { feature: 7 });

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 2,
    code: 'usage',
  });
});

test('it refuses a feature flag the feature map lacks before the command runs', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.runAsFeature('../../escape', ['notes', 'add'], { text: 'pay' });

  expect({
    exitCode: result.exitCode,
    code: result.envelope.error?.code,
    feature: result.envelope.feature,
  }).toStrictEqual({ exitCode: 2, code: 'usage', feature: null });
});

test('it names no run in the envelope of a move to a target with none', async () => {
  const ctx = await setupTest();

  await ctx.runOnPointers(['up']);

  const result = await ctx.runOnPointers(['use'], { target: 'prod' });

  expect({
    target: result.envelope.target,
    instance: result.envelope.instance,
    cursors: result.envelope.cursors,
  }).toStrictEqual({ target: 'prod', instance: null, cursors: {} });
});

test('it writes an envelope that parses against the published schema', async () => {
  const ctx = await setupTest();
  const result = await ctx.run('local', ['status']);

  expect(parsePublishedEnvelope(JSON.stringify(result.envelope))).toStrictEqual({
    valid: true,
    errors: [],
  });
});

test('it refuses a drive command on a target with no running run, with exit code 3', async () => {
  const ctx = await setupTest();
  const result = await ctx.run('local', ['notes', 'list']);

  expect({ exitCode: result.exitCode, error: result.envelope.error }).toStrictEqual({
    exitCode: 3,
    error: {
      code: 'not-running',
      message: 'Target local has no running run.',
      hint: 'Run `up --target local` first.',
    },
  });
});

test('it refuses a drive command until the doctor passes on the run', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);

  const result = await ctx.run('local', ['notes', 'list']);

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 3,
    code: 'doctor-required',
  });
});

test('it runs a driver command through the run supervisor once the doctor passed', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);
  await ctx.run('local', ['notes', 'add'], { text: 'buy milk' });

  const result = await ctx.run('local', ['notes', 'list']);

  expect({ ok: result.envelope.ok, data: result.envelope.data }).toStrictEqual({
    ok: true,
    data: { notes: ['buy milk'] },
  });
});

test('it refuses drives once the working tree changed, with the hint to restart', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  await writeFile(join(ctx.root, 'cart.ts'), 'export const total = 0;\n');

  const result = await ctx.run('local', ['notes', 'list']);

  expect(result.envelope.error).toStrictEqual({
    code: 'doctor-required',
    message: 'The working tree changed since this run started, so its doctor pass no longer holds.',
    hint: 'Run `up --restart`, then `doctor`.',
  });
});

test('it streams one NDJSON event per doctor check, each in the published schema', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  expect(ctx.lines.map((line): unknown => JSON.parse(line))).toStrictEqual([
    {
      wringer: 1,
      event: 'check',
      data: {
        name: 'notes.store',
        status: 'passed',
        durationMs: expect.any(Number),
        code: null,
        message: null,
      },
    },
  ]);
});

test('it times out a command past its deadline with exit code 5', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['action', 'hang']);

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 5,
    code: 'timeout',
  });
});

test("it writes a failure that a timed-out command's work hits after the answer to the run's log", async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['action', 'linger']);

  await result.late;

  const events = await ctx.state.readRunEvents(result.envelope.instance ?? '');

  expect({ code: result.envelope.error?.code, last: events.at(-1) }).toStrictEqual({
    code: 'timeout',
    last: {
      type: 'late-failure',
      at: expect.any(String),
      command: 'action.linger',
      code: 'internal',
      message: 'wringer failed with an internal error: The cleanup could not stop the remote work.',
    },
  });
});

test('it writes a late failure of a command that ran with no run to the late-failure log', async () => {
  const ctx = await setupTest();
  const result = await ctx.runWithin(50, ['recount'], {});

  await result.late;

  const log = await readFile(ctx.state.paths.lateFailures, 'utf8');

  const logged: unknown = JSON.parse(log);

  expect({ code: result.envelope.error?.code, log: logged }).toStrictEqual({
    code: 'timeout',
    log: {
      type: 'late-failure',
      at: expect.any(String),
      command: 'recount',
      code: 'internal',
      message: 'wringer failed with an internal error: The recount lost its place.',
    },
  });
});

test('it writes no event that a timed-out command emits after the answer', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const before = ctx.lines.length;

  const result = await ctx.run('local', ['action', 'linger']);

  await result.late;

  expect(ctx.lines.slice(before)).toStrictEqual([]);
});

test('it never runs the body of a command whose deadline passed while its guards ran', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);
  await ctx.runWithGatedGuards(50, ['action', 'receipt']);

  ctx.openGate();

  await ctx.guardsDone;

  // A later command runs its whole path through the drive after the guards are done, so a receipt
  // body that ran would have written by the time it returns.
  await ctx.run('local', ['action', 'count']);

  const receipts = await Array.fromAsync(
    new Bun.Glob('**/*-receipt.txt').scan({ cwd: ctx.root, dot: true }),
  );

  expect(receipts).toStrictEqual([]);
});

test('it turns a plain thrown error into an internal error with exit code 4', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['action', 'crash']);

  expect({ exitCode: result.exitCode, error: result.envelope.error }).toStrictEqual({
    exitCode: 4,
    error: {
      code: 'internal',
      message: 'wringer failed with an internal error: cannot read the cart',
      hint: null,
    },
  });
});

test('it keeps the evidence of a drive that failed in its envelope', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['action', 'crash']);

  expect(result.envelope.evidence).toStrictEqual([
    {
      kind: 'note',
      path: expect.stringMatching(/cart\.txt$/u),
      sha256: expect.any(String),
      scrub: 'text',
    },
  ]);
});

test('it answers with an internal error when the envelope is too large for the log', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['action', 'hoard']);

  expect({
    exitCode: result.exitCode,
    code: result.envelope.error?.code,
    evidence: result.envelope.evidence.length,
  }).toStrictEqual({ exitCode: 4, code: 'internal', evidence: 400 });
});

test('it answers with an internal error when the data has no JSON form', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['action', 'tally']);

  expect({
    exitCode: result.exitCode,
    code: result.envelope.error?.code,
    data: result.envelope.data,
  }).toStrictEqual({ exitCode: 4, code: 'internal', data: null });
});

test("it writes an internal error's stack to the run's log", async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['action', 'crash']);
  const events = await ctx.state.readRunEvents(result.envelope.instance ?? '');

  expect(events).toPartiallyContain({
    type: 'internal-error',
    command: 'action.crash',
    stack: expect.stringContaining('TypeError: cannot read the cart'),
  });
});

test('it moves data over the cap to an evidence file and marks the envelope truncated', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['action', 'flood']);

  const payload: unknown = await Bun.file(
    join(ctx.root, result.envelope.truncatedPath ?? ''),
  ).json();

  expect({
    truncated: result.envelope.truncated,
    data: result.envelope.data,
    payload,
  }).toStrictEqual({ truncated: true, data: null, payload: { text: 'x'.repeat(40 * 1024) } });
});

test('it refuses an action on a target it does not run on, with exit code 3', async () => {
  const ctx = await setupTest();

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);

  const result = await ctx.run('prod', ['action', 'local-only']);

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 3,
    code: 'target-not-allowed',
  });
});

test('it fails a raw exec that exits non-zero with check-failed and exit code 1', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['exec'], { argv: ['sh', '-c', 'echo nope; exit 3'] });

  expect({
    exitCode: result.exitCode,
    code: result.envelope.error?.code,
    data: result.envelope.data,
  }).toStrictEqual({
    exitCode: 1,
    code: 'check-failed',
    data: { exitCode: 3, stdout: 'nope\n', stderr: '' },
  });
});

test('it caps the data of a failed exec and still answers with its envelope', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['exec'], {
    argv: ['sh', '-c', 'yes x | head -c 100000; exit 2'],
  });

  expect({
    exitCode: result.exitCode,
    code: result.envelope.error?.code,
    truncated: result.envelope.truncated,
    data: result.envelope.data,
  }).toStrictEqual({ exitCode: 1, code: 'check-failed', truncated: true, data: null });
});

test('it keeps a drive under the feature it started with when `use` moves on meanwhile', async () => {
  const ctx = await setupTest();

  const directory = join(ctx.root, '.wringer');

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);
  await ctx.run('local', ['use'], { feature: 'checkout' });

  Bun.spawnSync(['mkfifo', join(directory, 'entered'), join(directory, 'gate')]);

  const paused = ctx.run('local', ['action', 'pause'], { directory });

  await readFile(join(directory, 'entered'), 'utf8');

  await ctx.run('local', ['use'], { feature: 'search' });

  await writeFile(join(directory, 'gate'), 'go\n');

  const result = await paused;

  expect({ exitCode: result.exitCode, feature: result.envelope.feature }).toStrictEqual({
    exitCode: 0,
    feature: 'checkout',
  });
});

test('it fails an exec of a missing command with an environment error and exit code 4', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['exec'], { argv: ['shop-no-such-tool'] });

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 4,
    code: 'environment',
  });
});

test('it refuses a write action on a read-only target with exit code 3 and the target hint', async () => {
  const ctx = await setupTest();

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);

  const result = await ctx.run('prod', ['action', 'seed']);

  expect({ exitCode: result.exitCode, error: result.envelope.error }).toStrictEqual({
    exitCode: 3,
    error: {
      code: 'read-only',
      message: '`action seed` is a write, and target prod is read-only.',
      hint: 'prod is read-only: reproduce it on local.',
    },
  });
});

test('it refuses a repo command with no declared effect on a read-only target', async () => {
  const ctx = await setupTest();

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);

  const result = await ctx.run('prod', ['restock']);

  expect({ exitCode: result.exitCode, error: result.envelope.error }).toStrictEqual({
    exitCode: 3,
    error: {
      code: 'read-only',
      message: '`restock` is a write, and target prod is read-only.',
      hint: 'prod is read-only: reproduce it on local.',
    },
  });
});

test('it runs a repo command that needs no run on a target with no run', async () => {
  const ctx = await setupTest();
  const result = await ctx.run('local', ['stock']);

  expect({ exitCode: result.exitCode, data: result.envelope.data }).toStrictEqual({
    exitCode: 0,
    data: { text: '12' },
  });
});

test("it gives a repo command that needs no run the running run's services", async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);
  await ctx.run('local', ['action', 'seed']);

  const result = await ctx.run('local', ['shelf']);

  expect({ exitCode: result.exitCode, data: result.envelope.data }).toStrictEqual({
    exitCode: 0,
    data: { count: 1 },
  });
});

test("it reaches a driver's service through the session's supervisor port", async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const calledAtMs = Date.now();

  await ctx.runRecordingCalls(['shelf']);

  expect(ctx.supervisorCalls).toHaveBeenCalledWith(
    expect.objectContaining({
      request: {
        service: 'notes/store',
        method: 'list',
        args: null,
        deadlineAt: expect.toBeWithin(calledAtMs, calledAtMs + 3_600_000),
      },
    }),
  );
});

test('it answers a timeout only after the service call that the deadline cancelled has settled', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.runWithSlowCancel(['shelf']);

  ctx.order.push('answered');

  expect({ code: result.envelope.error?.code, order: ctx.order }).toStrictEqual({
    code: 'timeout',
    order: ['call settled', 'answered'],
  });
});

test('it answers a timeout, not the failure of a call the command handled before its deadline', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.runWithSlowCancel(['recheck'], undefined, [
    new WringerError('check-failed', { message: 'The shelf was out of order.' }),
  ]);

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 5,
    code: 'timeout',
  });
});

test('it answers a command that timed out with the failure of a cancel that could not stop its call', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.runWithSlowCancel(
    ['shelf'],
    new WringerError('environment', {
      message: 'The page did not close, so its action may still run.',
    }),
  );

  expect({ exitCode: result.exitCode, error: result.envelope.error }).toStrictEqual({
    exitCode: 4,
    error: expect.objectContaining({
      code: 'environment',
      message: expect.stringContaining('The page did not close, so its action may still run.'),
    }),
  });
});

test('it refuses a driver call from a repo command that needs no run while no run is up', async () => {
  const ctx = await setupTest();
  const result = await ctx.run('local', ['shelf']);

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 3,
    code: 'not-running',
  });
});

test('it runs a declared read-only action on a read-only target', async () => {
  const ctx = await setupTest();

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);

  const result = await ctx.run('prod', ['action', 'count']);

  expect({ exitCode: result.exitCode, data: result.envelope.data }).toStrictEqual({
    exitCode: 0,
    data: { count: 0 },
  });
});

test('it refuses a write inside an action that declared a read, at the client call', async () => {
  const ctx = await setupTest();

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);

  const result = await ctx.run('prod', ['action', 'sneak']);

  expect({ exitCode: result.exitCode, error: result.envelope.error }).toStrictEqual({
    exitCode: 3,
    error: {
      code: 'read-only',
      message: 'notes add sneaky is a write, and the target is read-only.',
      hint: 'prod is read-only: reproduce it on local.',
    },
  });
});

test('it refuses a raw exec on a read-only target with exit code 3 and the target hint', async () => {
  const ctx = await setupTest();

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);

  const result = await ctx.run('prod', ['exec'], { argv: ['ls'] });

  expect({ exitCode: result.exitCode, error: result.envelope.error }).toStrictEqual({
    exitCode: 3,
    error: {
      code: 'read-only',
      message: '`exec` is a write, and target prod is read-only.',
      hint: 'prod is read-only: reproduce it on local.',
    },
  });
});

test('it runs a driver call the read-only target grants', async () => {
  const ctx = await setupTest();

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);

  const result = await ctx.run('prod', ['notes', 'add'], { text: 'granted' });

  expect({ exitCode: result.exitCode, data: result.envelope.data }).toStrictEqual({
    exitCode: 0,
    data: { count: 1 },
  });
});

test('it gives the package hint when a read-only target sets none', async () => {
  const ctx = await setupTest();

  await ctx.run('archive', ['attach']);
  await ctx.run('archive', ['doctor']);

  const result = await ctx.run('archive', ['exec'], { argv: ['ls'] });

  expect(result.envelope.error?.hint).toBe(
    'This target is read-only. Stop and report the write you needed.',
  );
});

test('it keeps a declared secret out of an action result', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['action', 'echo'], {
    text: 'the key is planted-shop-token',
  });

  expect(result.envelope.data).toStrictEqual({ text: 'the key is [redacted:SHOP_API_TOKEN]' });
});

test('it keeps a declared secret out of a stream event', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);
  await ctx.run('local', ['action', 'echo'], { text: 'the key is planted-shop-token' });

  expect(ctx.lines.filter((line) => line.includes('"echoed"'))).toStrictEqual([
    '{"wringer":1,"event":"echoed","data":{"text":"the key is [redacted:SHOP_API_TOKEN]"}}',
  ]);
});

test('it keeps a declared secret out of the error an action throws', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['action', 'echo-fail'], { text: 'planted-shop-token' });

  expect({ error: result.envelope.error, data: result.envelope.data }).toStrictEqual({
    error: {
      code: 'check-failed',
      message: 'The shelf said [redacted:SHOP_API_TOKEN].',
      hint: 'Try again after [redacted:SHOP_API_TOKEN] changes.',
    },
    data: { said: '[redacted:SHOP_API_TOKEN]' },
  });
});

test('it writes an over-cap payload file without the declared secret', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['action', 'echo-flood'], { text: 'planted-shop-token' });
  const payload = await readFile(join(ctx.root, result.envelope.truncatedPath ?? ''), 'utf8');

  expect({
    truncated: result.envelope.truncated,
    held: payload.includes('planted-shop-token'),
  }).toStrictEqual({
    truncated: true,
    held: false,
  });
});

test('it keeps a declared secret out of the run log, the features folder and the payloads', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);
  await ctx.run('local', ['action', 'echo'], { text: 'planted-shop-token' });
  await ctx.run('local', ['action', 'echo-fail'], { text: 'planted-shop-token' });
  await ctx.run('local', ['action', 'echo-flood'], { text: 'planted-shop-token' });

  const sinks = await ctx.readSinks();

  expect({
    leaked: sinks.includes('planted-shop-token'),
    kept: sinks.includes('[redacted:SHOP_API_TOKEN]'),
  }).toStrictEqual({ leaked: false, kept: true });
});

test('it keeps a driver config secret and a URL password out of an action result', async () => {
  const ctx = await setupTest();

  await ctx.run('secured', ['up']);
  await ctx.run('secured', ['doctor']);

  const basic = Buffer.from('shopper:driver-url-pass').toString('base64');

  const result = await ctx.run('secured', ['action', 'echo'], {
    text: `driver-config-token driver-url-pass Basic ${basic}`,
  });

  expect(result.envelope.data).toStrictEqual({
    text: `[redacted:notes.apiToken] [redacted:notes.url] Basic [redacted:notes.url]${basic.slice(Math.floor(23 / 3) * 4)}`,
  });
});

test('it scrubs a value a driver collects at runtime in a later command', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);
  await ctx.run('local', ['action', 'learn'], { text: 'planted-session-value' });

  const later = await ctx.run('local', ['action', 'echo'], {
    text: 'session planted-session-value ok',
  });

  expect(later.envelope.data).toStrictEqual({ text: 'session [redacted:notes.session] ok' });
});

test('it keeps a collected value in a file of mode 0600 until down removes it', async () => {
  const ctx = await setupTest();
  const up = await ctx.run('local', ['up']);

  const runID = up.envelope.instance ?? '';

  await ctx.run('local', ['doctor']);
  await ctx.run('local', ['action', 'learn'], { text: 'planted-session-value' });

  const info = await ctx.statSecretsFile(runID);
  const before = await ctx.readSecretsFile(runID);

  await ctx.run('local', ['down']);

  const after = await ctx
    .statSecretsFile(runID)
    .catch((error: unknown) =>
      error instanceof Error && 'code' in error ? error.code : 'unknown',
    );

  expect({ mode: info.mode & 0o777, before, after }).toStrictEqual({
    mode: 0o600,
    before: '{"name":"notes.session","value":"planted-session-value"}\n',
    after: 'ENOENT',
  });
});

test('it never lets a collected value reach a later sink', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);
  await ctx.run('local', ['action', 'learn'], { text: 'planted-session-value' });
  await ctx.run('local', ['action', 'echo'], { text: 'planted-session-value' });

  const sinks = await ctx.readSinks();

  expect(sinks.includes('planted-session-value')).toBe(false);
});

test.each([
  { text: 'session 482913 ready', expected: 'session [redacted:notes.session] ready' },
  { text: 'order 9482913 placed', expected: 'order 9482913 placed' },
])('it scrubs a collected 6-digit value only as a whole token in $text', async (row) => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);
  await ctx.run('local', ['action', 'learn'], { text: '482913' });

  const result = await ctx.run('local', ['action', 'echo'], { text: row.text });

  expect(result.envelope.data).toStrictEqual({ text: row.expected });
});

test('it collects GITHUB_TOKEN from the environment and leaves SSH_AUTH_SOCK and SESSION_TIMEOUT', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.runWithEnv(
    {
      GITHUB_TOKEN: 'planted-github-token',
      SSH_AUTH_SOCK: '/run/planted-agent-socket',
      SESSION_TIMEOUT: '3600',
    },
    'local',
    ['action', 'echo'],
    { text: 'planted-github-token /run/planted-agent-socket 3600' },
  );

  expect(result.envelope.data).toStrictEqual({
    text: '[redacted:GITHUB_TOKEN] /run/planted-agent-socket 3600',
  });
});

test('it answers a declared secret of 7 characters with a usage error that never names the value', async () => {
  const ctx = await setupTest();
  const result = await ctx.runWithEnv({ SHOP_API_TOKEN: 'abcdefg' }, 'local', ['features']);

  expect({
    code: result.envelope.error?.code,
    exitCode: result.exitCode,
    leaked: JSON.stringify(result.envelope).includes('abcdefg'),
  }).toStrictEqual({ code: 'usage', exitCode: 2, leaked: false });
});

test('it keeps a declared secret out of the payloads of a command that runs without a run', async () => {
  const ctx = await setupTest();
  const kept = await ctx.run('local', ['echo-runless'], { text: 'planted-shop-token' });
  const flooded = await ctx.run('local', ['echo-runless-flood'], { text: 'planted-shop-token' });
  const sinks = await ctx.readSinks();

  expect({
    data: kept.envelope.data,
    truncated: flooded.envelope.truncated,
    leaked: sinks.includes('planted-shop-token'),
    kept: sinks.includes('[redacted:SHOP_API_TOKEN]'),
  }).toStrictEqual({
    data: { text: '[redacted:SHOP_API_TOKEN]' },
    truncated: true,
    leaked: false,
    kept: true,
  });
});

test('it keeps a declared secret out of the late-failure log', async () => {
  const ctx = await setupTest();
  const result = await ctx.run('local', ['echo-late'], { text: 'planted-shop-token' });

  await result.late;

  const sinks = await ctx.readSinks();

  expect({
    code: result.envelope.error?.code,
    leaked: sinks.includes('planted-shop-token'),
    kept: sinks.includes('The cleanup lost [redacted:SHOP_API_TOKEN].'),
  }).toStrictEqual({ code: 'timeout', leaked: false, kept: true });
});

test('it keeps a declared secret out of the stack that an internal error writes to the run log', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['up']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['action', 'echo-crash'], { text: 'planted-shop-token' });
  const sinks = await ctx.readSinks();

  expect({
    code: result.envelope.error?.code,
    leaked: sinks.includes('planted-shop-token'),
    kept: sinks.includes('cannot read [redacted:SHOP_API_TOKEN]'),
  }).toStrictEqual({ code: 'internal', leaked: false, kept: true });
});
