import { findOwnValue } from '../find-own-value.ts';
import type { BuiltinContext } from '../types.ts';
import { callRunSupervisor } from './call-run-supervisor.ts';
import { pickStopPlan } from './pick-stop-plan.ts';
import type { StopData } from './stop-data-schema.ts';

// `down` and `detach` end the target's current run and clear its pointer, as `pickStopPlan`
// decides. A stop call that fails other than with a gone supervisor rejects, and leaves the run and
// its pointer for the next `down`.
export function stopRun(ctx: BuiltinContext): Promise<StopData> {
  return ctx.state.withTargetLock(ctx.targetName, async () => {
    const pointers = await ctx.state.readPointers();

    const runID = findOwnValue(pointers.currentRun, ctx.targetName);
    const view = runID === undefined ? undefined : await ctx.state.readRun(runID);

    if (runID !== undefined) {
      ctx.bindRun(runID);
    }

    const reach =
      view === undefined
        ? 'gone'
        : await callRunSupervisor(ctx.session.supervisor, view, 'stop', ctx.signal);

    const plan = pickStopPlan({ runID, status: view?.status, reach });

    if (runID !== undefined && plan.markCrashed) {
      await ctx.state.appendEvent(runID, {
        type: 'crashed',
        at: ctx.now().toISOString(),
        reason: "the run's supervisor was gone when the run was stopped",
      });

      await ctx.state.writeManifest(runID);
    }

    if (plan.clearPointer) {
      await ctx.state.writePointers((latest) => ({
        ...latest,
        currentRun: Object.fromEntries(
          Object.entries(latest.currentRun).filter(([target]) => target !== ctx.targetName),
        ),
      }));
    }

    return plan.data;
  });
}
