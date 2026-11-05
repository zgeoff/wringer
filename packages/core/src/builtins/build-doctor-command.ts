import { z } from 'zod';
import { buildBuiltinCommand } from '../build-commands.ts';
import { checkResultSchema } from '../run-events.ts';
import type { CheckResult } from '../run-events.ts';
import { toWringerError } from '../to-wringer-error.ts';
import type { BuiltinContext, Drive, RegisteredCommand } from '../types.ts';
import { WringerError } from '../wringer-error.ts';
import { pickDoctorOutcome } from './pick-doctor-outcome.ts';

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
      const results: CheckResult[] = [];

      for (const check of collectChecks(ctx, ctx.openDrive('read-only'))) {
        const result = await runCheck(ctx, check);

        results.push(result);
        ctx.emit('check', result);
      }

      const outcome = pickDoctorOutcome(results, ctx.now().toISOString());
      const runID = ctx.run?.runID ?? '';

      await ctx.state.appendEvent(runID, outcome.event);
      await ctx.state.writeManifest(runID);

      if (outcome.failure !== null) {
        throw outcome.failure;
      }

      return outcome.data;
    },
  });
}

interface PlannedCheck {
  readonly name: string;
  readonly timeoutMs: number;
  readonly run: (drive: Drive) => Promise<void>;
}

// Each check runs in a drive of its own, whose clients and execs stop at the check's deadline.
function collectChecks(ctx: BuiltinContext, drive: Drive): readonly PlannedCheck[] {
  const driverChecks = [...drive.drivers].flatMap(([driverName, opened]) =>
    opened.checks.map((check) => ({
      name: `${driverName}.${check.name}`,
      timeoutMs: check.timeoutMs,
      run: (checkDrive: Drive) => runDriverCheck(ctx, checkDrive, driverName, check.name),
    })),
  );

  const repoChecks = ctx.wringer.checks.map((check) => ({
    name: check.name,
    timeoutMs: check.timeoutMs,
    run: (checkDrive: Drive) => check.run(checkDrive.ctx),
  }));

  return [...driverChecks, ...repoChecks];
}

function runDriverCheck(
  ctx: BuiltinContext,
  drive: Drive,
  driverName: string,
  checkName: string,
): Promise<void> {
  const check = drive.drivers.get(driverName)?.checks.find((each) => each.name === checkName);

  if (check === undefined) {
    return Promise.reject(
      new WringerError('internal', {
        message: `The ${driverName} driver lost its check ${checkName}.`,
      }),
    );
  }

  return check.run(ctx.feature, ctx.emit);
}

async function runCheck(ctx: BuiltinContext, check: PlannedCheck): Promise<CheckResult> {
  const started = performance.now();
  const deadline = AbortSignal.any([ctx.signal, AbortSignal.timeout(check.timeoutMs)]);
  const deadlineAt = Math.min(ctx.deadlineAt, ctx.now().getTime() + check.timeoutMs);
  const timedOut = Promise.withResolvers<never>();

  // An abort listener added to a signal that already fired never runs, so the check would run on.
  if (deadline.aborted) {
    return {
      name: check.name,
      status: 'failed',
      durationMs: 0,
      code: 'timeout',
      message: `${check.name} did not start: the doctor's deadline had passed.`,
    };
  }

  const onAbort = (): void => {
    timedOut.reject(
      new WringerError('timeout', { message: `${check.name} ran past ${check.timeoutMs} ms.` }),
    );
  };

  deadline.addEventListener('abort', onAbort, { once: true });

  try {
    await Promise.race([
      check.run(ctx.openDrive('read-only', { signal: deadline, at: deadlineAt })),
      timedOut.promise,
    ]);

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
