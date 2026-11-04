import { z } from 'zod';
import { callSupervisor } from '../call-supervisor.ts';
import { supervisorServiceName } from '../supervisor-protocol.ts';
import type { BuiltinContext } from '../types.ts';

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
        : await callSupervisor({
            socket: view.supervisor.socket,
            request: { service: supervisorServiceName, method: 'stop', args: null },
            signal: ctx.signal,
          }).then(
            () => true,
            () => false,
          );

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
