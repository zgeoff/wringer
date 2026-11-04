import { z } from 'zod';
import { buildBuiltinCommand } from '../build-commands.ts';
import { checkResultSchema } from '../run-events.ts';
import type { CheckResult } from '../run-events.ts';
import { toWringerError } from '../to-wringer-error.ts';
import type { BuiltinContext, Drive, RegisteredCommand } from '../types.ts';
import { WringerError } from '../wringer-error.ts';

const doctorDataSchema = z.strictObject({
  passed: z.boolean(),
  results: z.array(checkResultSchema),
});

// The doctor runs every driver check and repo check on a read-only view of the target, so a check
// can only read. Its result lands in the log of the run it read, so a late result never passes a
// newer run.
export function buildDoctorCommand(): RegisteredCommand {
  return buildBuiltinCommand({
    path: ['doctor'],
    summary: 'Check the run is healthy; drive commands are refused until it passes',
    args: z.strictObject({}),
    data: doctorDataSchema,
    effect: 'read',
    needsRun: true,
    needsDoctor: false,
    run: async (_args, ctx) => {
      const drive = ctx.openDrive('read-only');
      const results: CheckResult[] = [];

      for (const check of collectChecks(ctx, drive)) {
        const result = await runCheck(check, ctx.signal);

        results.push(result);
        ctx.emit('check', result);
      }

      const passed = results.every((result) => result.status === 'passed');
      const runID = ctx.run?.runID ?? '';

      await ctx.state.appendEvent(runID, {
        type: passed ? 'doctor-passed' : 'doctor-failed',
        at: ctx.now().toISOString(),
        results,
      });

      await ctx.state.writeManifest(runID);

      if (!passed) {
        const failed = results.filter((result) => result.status === 'failed');

        throw new WringerError('check-failed', {
          message: `The doctor failed: ${failed.map((result) => result.name).join(', ')}.`,
          data: { passed, results },
        });
      }

      return { passed, results };
    },
  });
}

interface PlannedCheck {
  readonly name: string;
  readonly timeoutMs: number;
  readonly run: () => Promise<void>;
}

function collectChecks(ctx: BuiltinContext, drive: Drive): readonly PlannedCheck[] {
  const driverChecks = [...drive.drivers].flatMap(([driverName, opened]) =>
    opened.checks.map((check) => ({
      name: `${driverName}.${check.name}`,
      timeoutMs: check.timeoutMs,
      run: () => check.run(ctx.feature, ctx.emit),
    })),
  );

  const repoChecks = ctx.wringer.checks.map((check) => ({
    name: check.name,
    timeoutMs: check.timeoutMs,
    run: () => check.run(drive.ctx),
  }));

  return [...driverChecks, ...repoChecks];
}

async function runCheck(check: PlannedCheck, signal: AbortSignal): Promise<CheckResult> {
  const started = performance.now();
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(check.timeoutMs)]);
  const timedOut = Promise.withResolvers<never>();

  const onAbort = (): void => {
    timedOut.reject(
      new WringerError('timeout', { message: `${check.name} ran past ${check.timeoutMs} ms.` }),
    );
  };

  deadline.addEventListener('abort', onAbort, { once: true });

  try {
    await Promise.race([check.run(), timedOut.promise]);

    return {
      name: check.name,
      status: 'passed',
      durationMs: Math.round(performance.now() - started),
      code: null,
      message: null,
    };
  } catch (error) {
    const failure = toWringerError(error);

    return {
      name: check.name,
      status: 'failed',
      durationMs: Math.round(performance.now() - started),
      code: failure.code,
      message: failure.message,
    };
  } finally {
    deadline.removeEventListener('abort', onAbort);
  }
}
