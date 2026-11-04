import { z } from 'zod';
import { callSupervisor } from '../call-supervisor.ts';
import { supervisorServiceName } from '../supervisor-protocol.ts';
import type { BuiltinContext } from '../types.ts';
import { WringerError } from '../wringer-error.ts';

export const stopDataSchema = z.strictObject({
  run: z.string().nullable(),
  stopped: z.boolean(),
});

export type StopData = z.infer<typeof stopDataSchema>;

// `down` and `detach` end the target's current run and clear its pointer. A run whose supervisor
// already died is marked crashed, so its log still ends in a final status.
export function stopRun(ctx: BuiltinContext): Promise<StopData> {
  return ctx.state.withTargetLock(ctx.targetName, async () => {
    const pointers = await ctx.state.readPointers();

    const runID = pointers.currentRun[ctx.targetName];

    if (runID === undefined) {
      return { run: null, stopped: false };
    }

    const view = await ctx.state.readRun(runID);

    const stopped =
      view?.supervisor === null || view === undefined
        ? false
        : await runSupervisorStop(view.supervisor.socket, ctx.signal);

    if (!stopped && (view?.status === 'running' || view?.status === 'starting')) {
      await ctx.state.appendEvent(runID, {
        type: 'crashed',
        at: ctx.now().toISOString(),
        reason: "the run's supervisor was gone when the run was stopped",
      });

      await ctx.state.writeManifest(runID);
    }

    await ctx.state.writePointers((latest) => ({
      ...latest,
      currentRun: Object.fromEntries(
        Object.entries(latest.currentRun).filter(([target]) => target !== ctx.targetName),
      ),
    }));

    return { run: runID, stopped };
  });
}

// Only a supervisor that is gone lets the run end without its answer. A late or failed call leaves
// the run and its pointer in place, so the next `down` can still reach it.
async function runSupervisorStop(socket: string, signal: AbortSignal): Promise<boolean> {
  try {
    await callSupervisor({
      socket,
      request: { service: supervisorServiceName, method: 'stop', args: null },
      signal,
    });

    return true;
  } catch (error) {
    if (isSupervisorGone(error)) {
      return false;
    }

    throw error;
  }
}

export function isSupervisorGone(error: unknown): boolean {
  return error instanceof WringerError && error.code === 'not-running';
}
