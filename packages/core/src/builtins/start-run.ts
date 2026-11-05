import { z } from 'zod';
import type { RunView } from '../build-run-view.ts';
import { callSupervisor } from '../call-supervisor.ts';
import { readDefaultBase } from '../read-default-base.ts';
import { readFingerprint } from '../read-fingerprint.ts';
import { supervisorServiceName } from '../supervisor-protocol.ts';
import { toWringerError } from '../to-wringer-error.ts';
import type { BuiltinContext } from '../types.ts';
import { WringerError } from '../wringer-error.ts';
import { callRunSupervisor } from './call-run-supervisor.ts';
import { pickStartAction } from './pick-start-action.ts';
import type { StartFacts } from './pick-start-action.ts';

export const runDataSchema = z.strictObject({
  run: z.string(),
  target: z.string(),
  status: z.enum(['starting', 'running', 'crashed', 'ended']),
  endpoints: z.record(z.string(), z.string()),
  services: z.array(z.string()),
  reused: z.boolean(),
});

export type RunData = z.infer<typeof runDataSchema>;

export interface StartRunRequest {
  readonly restart: boolean;
  readonly readyTimeoutMs: number;
}

// `up` and `attach` hold the target's lock across check-and-create, so two at once never start two
// supervisors. A live run is reused, keeping its doctor pass, unless the caller asks for a restart.
export function startRun(ctx: BuiltinContext, request: StartRunRequest): Promise<RunData> {
  return ctx.state.withTargetLock(ctx.targetName, async () => {
    const pointers = await ctx.state.readPointers();

    const currentID = pointers.currentRun[ctx.targetName];
    const current = currentID === undefined ? undefined : await ctx.state.readRun(currentID);

    const reused = await settleCurrentRun(ctx, current, request.restart);

    if (reused !== null) {
      ctx.bindRun(reused.runID);

      return toRunData(reused, true);
    }

    const runID = buildRunID(ctx.now());

    ctx.bindRun(runID);

    const base = await readDefaultBase(ctx.session.root);

    const fingerprint = await readFingerprint(ctx.session.fingerprintHost, {
      cwd: ctx.session.root,
      base,
      exclude: [ctx.wringer.stateDir],
    });

    await ctx.state.appendEvent(runID, {
      type: 'run-started',
      at: ctx.now().toISOString(),
      target: ctx.targetName,
      mode: ctx.target.mode,
      fingerprint,
    });

    await ctx.state.writePointers((latest) => ({
      ...latest,
      currentRun: { ...latest.currentRun, [ctx.targetName]: runID },
    }));

    try {
      await ctx.session.supervisor.start({ runID, target: ctx.targetName });
    } catch (error) {
      // A run whose supervisor never started can never finish starting, so it ends here.
      await ctx.state.appendEvent(runID, {
        type: 'crashed',
        at: ctx.now().toISOString(),
        reason: `the supervisor could not start: ${toWringerError(error).message}`,
      });

      throw error;
    }

    try {
      const ready = await waitForReady(ctx, runID, request.readyTimeoutMs);

      return toRunData(ready, false);
    } catch (error) {
      await stopAbandonedRun(ctx, runID);

      throw error;
    }
  });
}

// Carries out what `pickStartAction` asks for until the current run is reused or out of the way.
// Resolves the run to reuse, or null once a new run may start. A ping that times out rejects, so a
// slow supervisor is never taken for a dead one.
async function settleCurrentRun(
  ctx: BuiltinContext,
  current: RunView | undefined,
  restart: boolean,
): Promise<RunView | null> {
  let facts: StartFacts = { status: current?.status ?? null, restart, ping: null, stop: null };

  for (;;) {
    const action = pickStartAction(facts);

    if (current === undefined || action === 'start') {
      return null;
    }

    if (action === 'reuse') {
      return current;
    }

    if (action === 'mark-crashed') {
      await ctx.state.appendEvent(current.runID, {
        type: 'crashed',
        at: ctx.now().toISOString(),
        reason: "the run's supervisor stopped answering",
      });

      return null;
    }

    facts =
      action === 'ping'
        ? { ...facts, ping: await callRunSupervisor(current, 'ping', makePingSignal(ctx)) }
        : { ...facts, stop: await callRunSupervisor(current, 'stop', ctx.signal) };
  }
}

const pingTimeoutMs = 2000;

function makePingSignal(ctx: BuiltinContext): AbortSignal {
  return AbortSignal.any([ctx.signal, AbortSignal.timeout(pingTimeoutMs)]);
}

function toRunData(view: RunView, reused: boolean): RunData {
  return {
    run: view.runID,
    target: view.target,
    status: view.status,
    endpoints: view.endpoints,
    services: [...view.services],
    reused,
  };
}

function buildRunID(date: Date): string {
  const random = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, '0');

  return `${date.getTime().toString(36)}-${random}`;
}

const readyPollMs = 50;

async function waitForReady(
  ctx: BuiltinContext,
  runID: string,
  timeoutMs: number,
): Promise<RunView> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (ctx.signal.aborted) {
      throw new WringerError('timeout', {
        message: `The command's deadline passed while run ${runID} started.`,
        hint: 'Pass a longer `--timeout-ms`, then run `up` again.',
      });
    }

    const view = await ctx.state.readRun(runID);

    if (view?.status === 'running') {
      return view;
    }

    if (view?.status === 'crashed' || view?.status === 'ended') {
      throw new WringerError('environment', {
        message: `Run ${runID} stopped while it started: ${view.crashReason ?? 'it ended'}.`,
        hint: `Read .wringer/runs/${runID}/children/app.log and supervisor.log.`,
      });
    }

    await Bun.sleep(readyPollMs);
  }

  throw new WringerError('timeout', {
    message: `Run ${runID} was not ready within ${timeoutMs} ms.`,
    hint: `Read .wringer/runs/${runID}/children/app.log, then run \`up\` again.`,
  });
}

const stopTimeoutMs = 15_000;

// A run that missed its deadline must not keep its app and services up behind the error. Its
// supervisor may not have opened its socket yet, so the stop waits for the socket first.
async function stopAbandonedRun(ctx: BuiltinContext, runID: string): Promise<void> {
  const socket = await readSupervisorSocket(ctx, runID);

  if (socket === null) {
    return;
  }

  try {
    await callSupervisor({
      socket,
      request: { service: supervisorServiceName, method: 'stop', args: null },
      signal: AbortSignal.timeout(stopTimeoutMs),
    });
  } catch {
    // The supervisor is already gone, which is the state this function wants.
  }
}

const socketWaitMs = 10_000;

// Resolves null once the run has ended, or when its supervisor never opens a socket.
async function readSupervisorSocket(ctx: BuiltinContext, runID: string): Promise<string | null> {
  const deadline = Date.now() + socketWaitMs;

  while (Date.now() < deadline) {
    const view = await ctx.state.readRun(runID);

    if (view === undefined || view.status === 'crashed' || view.status === 'ended') {
      return null;
    }

    if (view.supervisor !== null) {
      return view.supervisor.socket;
    }

    await Bun.sleep(readyPollMs);
  }

  return null;
}
