import { z } from 'zod';
import { buildChangeFactsRequest } from '../build-change-request.ts';
import type { RunView } from '../build-run-view.ts';
import { findOwnValue } from '../find-own-value.ts';
import { readChangeFacts } from '../read-change-facts.ts';
import { readDefaultBase } from '../read-default-base.ts';
import { supervisorServiceName } from '../supervisor-protocol.ts';
import { toWringerError } from '../to-wringer-error.ts';
import type { BuiltinContext, SupervisorExit } from '../types.ts';
import { WringerError } from '../wringer-error.ts';
import { writeLateFailure } from '../write-late-failure.ts';
import { callRunSupervisor, isSupervisorGone } from './call-run-supervisor.ts';
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
  readonly command: 'up' | 'attach';
  readonly restart: boolean;
  readonly readyTimeoutMs: number;
}

// `up` and `attach` hold the target's lock across check-and-create, so two at once never start two
// supervisors. A live run is reused, keeping its doctor pass, unless the caller asks for a restart.
export function startRun(ctx: BuiltinContext, request: StartRunRequest): Promise<RunData> {
  return ctx.state.withTargetLock(ctx.targetName, async () => {
    const pointers = await ctx.state.readPointers();

    const currentID = findOwnValue(pointers.currentRun, ctx.targetName);
    const current = currentID === undefined ? undefined : await ctx.state.readRun(currentID);

    const reused = await settleCurrentRun(ctx, current, request.restart);

    if (reused !== null) {
      ctx.bindRun(reused.runID);

      return toRunData(reused, true);
    }

    const runID = buildRunID(ctx.now());

    ctx.bindRun(runID);

    const base = await readDefaultBase(ctx.session.repoHost, ctx.session.root);

    const facts = await readChangeFacts(
      ctx.session.repoHost,
      buildChangeFactsRequest(ctx.wringer, ctx.session.root, base),
    );

    // The caller has its timeout already once the deadline passes, so no run starts after it.
    if (ctx.signal.aborted) {
      throw new WringerError('timeout', {
        message: `The command's deadline passed before run ${runID} started.`,
        hint: 'Pass a longer `--timeout-ms`, then run `up` again.',
      });
    }

    await ctx.state.appendEvent(runID, {
      type: 'run-started',
      at: ctx.now().toISOString(),
      target: ctx.targetName,
      mode: ctx.target.mode,
      fingerprint: facts.fingerprint,
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
      const ready = await waitForReady(ctx, runID, request.readyTimeoutMs, trackExit(ctx, runID));

      return toRunData(ready, false);
    } catch (error) {
      await stopAbandonedRun(ctx, runID, request.command);

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
        ? {
            ...facts,
            ping: await callRunSupervisor(
              ctx.session.supervisor,
              current,
              'ping',
              makePingSignal(ctx),
            ),
          }
        : {
            ...facts,
            stop: await callRunSupervisor(ctx.session.supervisor, current, 'stop', ctx.signal),
          };
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

interface ExitTracker {
  readonly read: () => SupervisorExit | null;
}

async function waitForReady(
  ctx: BuiltinContext,
  runID: string,
  timeoutMs: number,
  tracker: ExitTracker,
): Promise<RunView> {
  const deadline = ctx.now().getTime() + timeoutMs;

  while (ctx.now().getTime() < deadline) {
    if (ctx.signal.aborted) {
      throw new WringerError('timeout', {
        message: `The command's deadline passed while run ${runID} started.`,
        hint: 'Pass a longer `--timeout-ms`, then run `up` again.',
      });
    }

    // The exit is read before the log, so a supervisor that wrote its last event and then exited
    // is never taken for one that exited silently.
    const exit = tracker.read();

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

    if (exit !== null) {
      const reason = `the supervisor exited with ${describeExit(exit)} before the run was ready`;

      await ctx.state.appendEvent(runID, {
        type: 'crashed',
        at: ctx.now().toISOString(),
        reason,
      });

      throw new WringerError('environment', {
        message: `Run ${runID} stopped while it started: ${reason}.`,
        hint: `Read .wringer/runs/${runID}/supervisor.log.`,
      });
    }

    await ctx.wait(readyPollMs);
  }

  throw new WringerError('timeout', {
    message: `Run ${runID} was not ready within ${timeoutMs} ms.`,
    hint: `Read .wringer/runs/${runID}/children/app.log, then run \`up\` again.`,
  });
}

function describeExit(exit: SupervisorExit): string {
  return exit.signal === null ? `code ${exit.code}` : `signal ${exit.signal}`;
}

// Remembers how the run's supervisor process exited, once it has, for the readiness loop to read
// between polls. A port without exit news never reports one.
function trackExit(ctx: BuiltinContext, runID: string): ExitTracker {
  let exit: SupervisorExit | null = null;

  const watch = async (): Promise<void> => {
    try {
      const found = await ctx.session.supervisor.watchExit?.(runID);

      exit = found ?? null;
    } catch {
      // A watch that fails leaves the readiness loop on the run's log alone.
    }
  };

  void watch();

  return { read: () => exit };
}

// A run that missed its deadline must not keep its app and services up behind the error. The stop
// waits for a socket the supervisor may not have opened yet, and as the command's own error answers
// first, a failed stop can only go to the run's log.
async function stopAbandonedRun(
  ctx: BuiltinContext,
  runID: string,
  command: StartRunRequest['command'],
): Promise<void> {
  const socket = await readSupervisorSocket(ctx, runID);

  if (socket === null) {
    return;
  }

  await writeLateFailure(callSupervisorStop(ctx, socket), {
    state: ctx.state,
    runID,
    command,
    answered: null,
    now: ctx.now,
  });
}

const socketWaitMs = 10_000;

// Resolves null once the run has ended, or when its supervisor never opens a socket.
async function readSupervisorSocket(ctx: BuiltinContext, runID: string): Promise<string | null> {
  const deadline = ctx.now().getTime() + socketWaitMs;

  while (ctx.now().getTime() < deadline) {
    const view = await ctx.state.readRun(runID);

    if (view === undefined || view.status === 'crashed' || view.status === 'ended') {
      return null;
    }

    if (view.supervisor !== null) {
      return view.supervisor.socket;
    }

    await ctx.wait(readyPollMs);
  }

  return null;
}

const stopTimeoutMs = 15_000;

// A supervisor that is already gone is the state the stop wants.
async function callSupervisorStop(ctx: BuiltinContext, socket: string): Promise<void> {
  try {
    await ctx.session.supervisor.call({
      socket,
      request: { service: supervisorServiceName, method: 'stop', args: null },
      signal: AbortSignal.timeout(stopTimeoutMs),
    });
  } catch (error) {
    if (!isSupervisorGone(error)) {
      throw error;
    }
  }
}
