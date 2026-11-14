import { z } from 'zod';
import { readRevision, revisionTimeoutMs } from '../dispatch/read-revision.ts';
import { writeLateFailure } from '../dispatch/write-late-failure.ts';
import { buildBuiltinCommand } from '../registry/build-builtin-command.ts';
import { pickRevisionRefusal } from '../secrets/pick-revision-refusal.ts';
import { checkResultSchema } from '../state/run-event.ts';
import type { CheckResult } from '../state/run-event.ts';
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
      const read: { revision: string | null } = { revision: null };

      const checks = collectChecks(ctx, ctx.openDrive('read-only'), (value) => {
        read.revision = value;
      });

      for (const check of checks) {
        const result = await runCheck(ctx, check);

        results.push(result);
        ctx.emit('check', result);
      }

      const outcome = pickDoctorOutcome(results, ctx.now().toISOString());
      const runID = ctx.run?.runID ?? '';

      if (read.revision !== null && outcome.failure === null) {
        await ctx.state.appendEvent(runID, {
          type: 'revision-read',
          at: outcome.event.at,
          revision: read.revision,
        });
      }

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
function collectChecks(
  ctx: BuiltinContext,
  drive: Drive,
  onRevision: (revision: string) => void,
): readonly PlannedCheck[] {
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

  return [...driverChecks, ...repoChecks, ...collectRevisionChecks(ctx, onRevision)];
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

// An attach target that names its deployed commit gets one more check, on the same read-only drive.
function collectRevisionChecks(
  ctx: BuiltinContext,
  onRevision: (revision: string) => void,
): readonly PlannedCheck[] {
  const target = ctx.target;

  if (target.mode !== 'attach' || target.revision === undefined) {
    return [];
  }

  const revision = target.revision;

  return [
    {
      name: 'revision',
      timeoutMs: revisionTimeoutMs,
      run: async (checkDrive) => {
        const value = await readRevision(revision, checkDrive.ctx);

        const refusal = pickRevisionRefusal(value, ctx.secrets);

        if (refusal !== null) {
          throw refusal;
        }

        onRevision(value);
      },
    },
  ];
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

  // A check that throws before it returns its promise fails like one that rejects.
  const work = Promise.try(() =>
    check.run(ctx.openDrive('read-only', { signal: deadline, at: deadlineAt })),
  );

  try {
    await Promise.race([work, timedOut.promise]);

    return {
      name: check.name,
      status: 'passed',
      durationMs: Math.round(performance.now() - started),
      code: null,
      message: null,
    };
  } catch (error) {
    const failure = toWringerError(error);

    // The doctor answers at the check's timeout, while the check runs on in the run it read.
    if (deadline.aborted) {
      ctx.keepLate(
        writeLateFailure(work, {
          state: ctx.state,
          runID: ctx.run?.runID ?? '',
          command: `doctor ${check.name}`,
          answered: null,
          now: ctx.now,
        }),
      );
    }

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
