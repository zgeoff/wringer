import { z } from 'zod';
import type { RunView } from '../build-run-view.ts';
import { callSupervisor } from '../call-supervisor.ts';
import { readDefaultBase } from '../read-default-base.ts';
import { readFingerprint } from '../read-fingerprint.ts';
import { supervisorServiceName } from '../supervisor-protocol.ts';
import type { BuiltinContext } from '../types.ts';
import { WringerError } from '../wringer-error.ts';

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

    // A run still starting here is one an earlier `up` gave up waiting for; it is replaced, never
    // reused, so its app and services are stopped first.
    if (current?.status === 'running' || current?.status === 'starting') {
      const alive = await probeSupervisor(current);

      if (alive && current.status === 'running' && !request.restart) {
        return toRunData(current, true);
      }

      if (alive) {
        await callSupervisor({
          socket: current.supervisor?.socket ?? '',
          request: { service: supervisorServiceName, method: 'stop', args: null },
          signal: ctx.signal,
        });
      } else {
        await ctx.state.appendEvent(current.runID, {
          type: 'crashed',
          at: ctx.now().toISOString(),
          reason: "the run's supervisor stopped answering",
        });
      }
    }

    const runID = buildRunID(ctx.now());

    const base = await readDefaultBase(ctx.session.root);

    const fingerprint = await readFingerprint({
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

    await ctx.session.supervisor.start({ runID, target: ctx.targetName });

    try {
      const ready = await waitForReady(ctx, runID, request.readyTimeoutMs);

      return toRunData(ready, false);
    } catch (error) {
      await stopAbandonedRun(ctx, runID);

      throw error;
    }
  });
}

const pingTimeoutMs = 2000;

async function probeSupervisor(run: RunView): Promise<boolean> {
  if (run.supervisor === null) {
    return false;
  }

  try {
    await callSupervisor({
      socket: run.supervisor.socket,
      request: { service: supervisorServiceName, method: 'ping', args: null },
      signal: AbortSignal.timeout(pingTimeoutMs),
    });

    return true;
  } catch {
    return false;
  }
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

// A run that missed its deadline must not keep its app and services up behind the error.
async function stopAbandonedRun(ctx: BuiltinContext, runID: string): Promise<void> {
  const view = await ctx.state.readRun(runID);

  if (view?.supervisor === null || view === undefined) {
    return;
  }

  try {
    await callSupervisor({
      socket: view.supervisor.socket,
      request: { service: supervisorServiceName, method: 'stop', args: null },
      signal: AbortSignal.timeout(stopTimeoutMs),
    });
  } catch {
    // The supervisor is already gone, which is the state this function wants.
  }
}
