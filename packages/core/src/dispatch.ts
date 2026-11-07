import { join } from 'node:path';
import { match } from 'ts-pattern';
import { buildEnvelope } from './build-envelope.ts';
import type { RunView } from './build-run-view.ts';
import { buildRunPaths } from './build-state-paths.ts';
import { capData } from './cap-data.ts';
import type { StatePort } from './create-file-state.ts';
import { envelopeVersion } from './envelope-version.ts';
import type { Envelope, Evidence } from './envelope.ts';
import type { ExitCode } from './error-codes.ts';
import { findOwnValue } from './find-own-value.ts';
import { getTarget } from './get-target.ts';
import type { Access } from './host.ts';
import { keepCancelledCall } from './keep-cancelled-call.ts';
import { defaultRefusalHint } from './make-fence.ts';
import { openDrive, unassignedFeature } from './open-drive.ts';
import { openRunlessDrive } from './open-runless-drive.ts';
import { pickAccessRefusal } from './pick-access-refusal.ts';
import { pickCommandNeeds } from './pick-command-needs.ts';
import { pickCommandPlan } from './pick-command-plan.ts';
import { pickContextTarget } from './pick-context-target.ts';
import type { DriveKind } from './pick-drive-kind.ts';
import { pickEnvelopeContext } from './pick-envelope-context.ts';
import { pickEnvelopePayload } from './pick-envelope-payload.ts';
import { pickEnvelopeRun } from './pick-envelope-run.ts';
import { pickEnvelopeTarget } from './pick-envelope-target.ts';
import { pickLogRefusal } from './pick-log-refusal.ts';
import { raceDeadline } from './race-deadline.ts';
import { readDefaultBase } from './read-default-base.ts';
import { readFingerprint } from './read-fingerprint.ts';
import { readHeadSHA } from './read-head-sha.ts';
import type { RunID } from './run-events.ts';
import { settleDispatchAnswer } from './settle-dispatch-answer.ts';
import { settleEnvelope } from './settle-envelope.ts';
import { toWringerError } from './to-wringer-error.ts';
import type {
  ArgsResult,
  BuiltinContext,
  Deadline,
  Drive,
  Effect,
  Emit,
  RegisteredCommand,
  Session,
  TargetDefinition,
  Wringer,
} from './types.ts';
import { waitForCancelledCalls } from './wait-for-cancelled-calls.ts';
import { WringerError } from './wringer-error.ts';
import { writeEnvelopeLog } from './write-envelope-log.ts';
import { writeLateFailure } from './write-late-failure.ts';

export interface DispatchResult {
  readonly envelope: Envelope;
  readonly exitCode: ExitCode;

  // Settles once a command that timed out has finished its own work, with any failure of that work
  // in the run's log.
  readonly late: Promise<void>;
}

export const defaultTimeoutMs = 120_000;

interface CommandOutcome {
  readonly data: unknown;
}

// What a command has done so far, filled in as it runs, so a command that fails or misses its
// deadline still reports the evidence it kept and the run and feature it drove.
interface DriveTrace {
  readonly evidence: (readonly Evidence[])[];
  drive: boolean;
  ranOnRun: boolean;
  boundRun: RunID | null;
  readonly late: Promise<void>[];

  // Each service call to the run's supervisor that was still running at the deadline.
  readonly calls: Promise<unknown>[];

  // Set once the command's outcome is settled, so the work's later events never follow the answer.
  answered: boolean;
}

// Every command, built-in, driver, repo or action, ends here and yields exactly one envelope.
// Dispatch is the one place that catches: a thrown error of any kind becomes the envelope's error.
export async function dispatch(
  wringer: Wringer,
  path: readonly string[],
  rawArgs: unknown,
  session: Session,
): Promise<DispatchResult> {
  const startedMs = performance.now();
  const now = session.now ?? (() => new Date());
  const stateDir = join(session.root, wringer.stateDir);
  const state = session.state;

  const read = await readContext(wringer, path, state, session).catch((error: unknown) =>
    toWringerError(error),
  );

  const before = read instanceof WringerError ? null : read;
  let outcome: CommandOutcome | null = null;
  let failure: WringerError | null = null;
  let pending: Promise<CommandOutcome> | null = null;

  const trace: DriveTrace = {
    evidence: [],
    drive: false,
    ranOnRun: false,
    boundRun: null,
    late: [],
    calls: [],
    answered: false,
  };

  try {
    if (read instanceof WringerError) {
      throw read;
    }

    const context = read;
    const command = wringer.commands.get(path.join(' '));

    if (command === undefined) {
      throw new WringerError('usage', { message: `There is no command \`${path.join(' ')}\`.` });
    }

    const timeoutMs = session.timeoutMs ?? command.info.timeoutMs ?? defaultTimeoutMs;
    const deadline = AbortSignal.timeout(timeoutMs);

    const work = runCommand({
      wringer,
      state,
      session,
      stateDir,
      command,
      rawArgs,
      context,
      now,
      deadline,
      deadlineAt: now().getTime() + timeoutMs,
      trace,
    });

    pending = work;

    outcome = await raceDeadline(work, deadline);

    pending = null;
  } catch (error) {
    failure = toWringerError(error);

    // Only a timeout leaves the work running; any other failure is the work's own, and it is over.
    if (failure.code !== 'timeout') {
      pending = null;
    }
  }

  // A timeout never reaches the caller while a cancelled call's work can still land, and a cancel
  // that failed answers in the timeout's place.
  if (failure?.code === 'timeout') {
    const cancelFailure = await waitForCancelledCalls(trace.calls);

    failure = cancelFailure ?? failure;
  }

  trace.answered = true;

  const after = await readContext(wringer, path, state, session).catch(() => before);
  const bound = await readBoundRun(state, trace.boundRun);

  const settled = pickEnvelopeContext(before, after, trace.ranOnRun);
  const run = pickEnvelopeRun(before, settled, bound);
  const feature = settled?.feature ?? null;

  const payload = pickEnvelopePayload({
    data: outcome?.data,
    commandFailure: failure,
    cursors: run === undefined ? {} : await readEnvelopeCursors(state, run.runID),
  });

  const capped = await capData(payload.data, {
    root: session.root,
    directory:
      run === undefined
        ? join(stateDir, 'payloads')
        : join(buildRunPaths(stateDir, run.runID).features, feature ?? unassignedFeature),
    now,
    files: session.repoHost,
  });

  const input = settleEnvelope({
    command: path.join('.'),
    target: pickEnvelopeTarget(settled, bound),
    instance: run?.runID ?? null,
    feature,
    sha: await readHeadSHA(session.repoHost, session.root),
    durationMs: performance.now() - startedMs,
    driveEvidence: trace.evidence.flat(),
    payload,
    capped,
  });

  const envelope = buildEnvelope(input);

  const commandLate =
    pending === null
      ? Promise.resolve()
      : writeLateFailure(pending, {
          state,
          runID: run?.runID ?? null,
          command: envelope.command,
          answered: failure,
          now,
        });

  const late = waitForLate([commandLate, ...trace.late]);

  const logFailure =
    run === undefined
      ? null
      : await writeEnvelopeLog(state, run, envelope, {
          drive: trace.drive,
          failure: input.error,
          now,
          refuse: pickLogRefusal(envelope, before?.run),
        });

  return { ...settleDispatchAnswer(input, logFailure), late };
}

interface CommandContext {
  readonly targetName: string;
  readonly target: TargetDefinition;
  readonly run: RunView | undefined;
  readonly feature: string | null;
  readonly cursors: Readonly<Record<string, number>>;
}

async function readContext(
  wringer: Wringer,
  path: readonly string[],
  state: StatePort,
  session: Session,
): Promise<CommandContext> {
  // A feature names a folder of the run, so only a feature of the map may reach a path; `use` checks
  // the feature it saves, and this checks the one a command passes.
  if (
    session.feature !== undefined &&
    !wringer.features.some((feature) => feature.name === session.feature)
  ) {
    throw new WringerError('usage', {
      message: `The feature map has no feature named ${session.feature}.`,
      hint: 'Run `features` to list them.',
    });
  }

  const pointers = await state.readPointers();

  const targetName = pickContextTarget({
    targetNames: [...wringer.targets.keys()],
    sessionTarget: session.target,
    savedTarget: pointers.target,
    commandKey: path.join(' '),
  });

  const target = getTarget(wringer, targetName);
  const runID = findOwnValue(pointers.currentRun, targetName);
  const run = runID === undefined ? undefined : await state.readRun(runID);

  return {
    targetName,
    target,
    run,
    feature: session.feature ?? pointers.feature ?? null,

    // Saved cursors are offsets into one run's streams; another run's streams start over.
    cursors: runID !== undefined && pointers.cursorsRun === runID ? pointers.cursors : {},
  };
}

interface CommandRequest {
  readonly wringer: Wringer;
  readonly state: StatePort;
  readonly session: Session;
  readonly stateDir: string;
  readonly command: RegisteredCommand;
  readonly rawArgs: unknown;
  readonly context: CommandContext;
  readonly now: () => Date;
  readonly deadline: AbortSignal;
  readonly deadlineAt: number;
  readonly trace: DriveTrace;
}

// Reads the facts, leaves each decision to the pure planners, and carries out the plan.
async function runCommand(request: CommandRequest): Promise<CommandOutcome> {
  const info = request.command.info;
  const context = request.context;

  const needs = pickCommandNeeds({
    isBuiltin: request.command.kind === 'builtin',
    needsRun: info.needsRun,
    needsDoctor: info.needsDoctor,
    mode: context.target.mode,
    doctor: context.run?.doctor,
  });

  const fingerprintChanged = needs.readsFingerprint
    ? await probeFingerprintChanged(request)
    : false;

  const plan = pickCommandPlan({
    needsRun: needs.needsRun,
    needsDoctor: needs.needsDoctor,
    isRepoCommand: request.command.kind === 'repo',
    run: context.run,
    targetName: context.targetName,
    mode: context.target.mode,
    fingerprintChanged,
    deadlinePassed: request.deadline.aborted,
  });

  if (plan.kind === 'refuse') {
    throw plan.failure;
  }

  const hint = context.target.refusalHint ?? defaultRefusalHint;
  const drive = openCommandDrive(request, plan.driveKind, hint);
  const prepared = prepareCommand(request, drive, hint);

  const accessRefusal = pickAccessRefusal({
    path: info.path,
    allowedTargets: request.command.kind === 'repo' ? request.command.targets : undefined,
    targetName: context.targetName,
    access: context.target.access,
    effect: prepared.effect,
    hint,
  });

  if (accessRefusal !== null) {
    throw accessRefusal;
  }

  // A drive's evidence list grows as the command runs; the trace holds the same list, one per drive.
  if (drive !== undefined) {
    request.trace.evidence.push(drive.evidence);
  }

  request.trace.drive = plan.drive;
  request.trace.ranOnRun = plan.driveKind === 'run';

  const data = await prepared.run();

  const output = info.data.safeParse(data);

  if (!output.success) {
    throw new WringerError('internal', {
      message: `\`${info.path.join(' ')}\` returned data that does not match its schema: ${output.error.message}`,
      data: { stack: output.error.stack ?? output.error.message },
    });
  }

  return { data: output.data };
}

async function probeFingerprintChanged(request: CommandRequest): Promise<boolean> {
  const base = await readDefaultBase(request.session.repoHost, request.session.root);

  const fingerprint = await readFingerprint(request.session.repoHost, {
    cwd: request.session.root,
    base,
    exclude: [request.wringer.stateDir],
  });

  return fingerprint !== request.context.run?.fingerprint;
}

function openCommandDrive(
  request: CommandRequest,
  kind: DriveKind,
  hint: string,
): Drive | undefined {
  const run = request.context.run;
  const access = request.context.target.access;

  if (kind === 'run' && run !== undefined) {
    return openRunDrive(request, { run, access, hint });
  }

  if (kind === 'runless') {
    return openRunlessDrive({
      wringer: request.wringer,
      root: request.session.root,
      stateDir: request.stateDir,
      targetName: request.context.targetName,
      target: request.context.target,
      access,
      hint,
      feature: request.context.feature,
      signal: request.deadline,
      now: request.now,
      emit: makeEmit(request.session, request.trace),
      files: request.session.repoHost,
    });
  }

  return undefined;
}

interface RunDriveOptions {
  readonly run: RunView;
  readonly access: Access;
  readonly hint: string;
  readonly deadline?: Deadline | undefined;
}

function openRunDrive(request: CommandRequest, options: RunDriveOptions): Drive {
  return openDrive({
    wringer: request.wringer,
    root: request.session.root,
    stateDir: request.stateDir,
    targetName: request.context.targetName,
    target: request.context.target,
    access: options.access,
    hint: options.hint,
    run: options.run,
    feature: request.context.feature,
    cursors: request.context.cursors,
    signal: options.deadline?.signal ?? request.deadline,
    deadlineAt: options.deadline?.at ?? request.deadlineAt,
    now: request.now,
    emit: makeEmit(request.session, request.trace),
    files: request.session.repoHost,
    callSupervisor: (call) => {
      const calling = request.session.supervisor.call(call);

      keepCancelledCall(request.trace.calls, calling, request.deadline);

      return calling;
    },
  });
}

function makeEmit(session: Session, trace: Readonly<DriveTrace>): Emit {
  return (event, data) => {
    if (trace.answered) {
      return;
    }

    session.output.writeLine(JSON.stringify({ wringer: envelopeVersion, event, data }));
  };
}

interface ReadyCommand {
  readonly effect: Effect;
  readonly run: () => Promise<unknown>;
}

function prepareCommand(
  request: CommandRequest,
  drive: Drive | undefined,
  hint: string,
): ReadyCommand {
  return match(request.command)
    .returnType<ReadyCommand>()
    .with({ kind: 'builtin' }, (builtin) => {
      const prepared = getPrepared(builtin.prepare(request.rawArgs));

      return {
        effect: prepared.effect,
        run: () => prepared.run(buildBuiltinContext(request, hint)),
      };
    })
    .with({ kind: 'repo' }, (repo) => {
      const prepared = getPrepared(repo.prepare(request.rawArgs));

      return { effect: prepared.effect, run: () => prepared.run(getDrive(drive).ctx) };
    })
    .with({ kind: 'driver' }, (driverCommand) => {
      const opened = getDrive(drive).drivers.get(driverCommand.driver);

      if (opened === undefined) {
        throw new WringerError('usage', {
          message: `Target ${request.context.targetName} gives the ${driverCommand.driver} driver no config.`,
        });
      }

      const prepared = getPrepared(
        opened.prepare(driverCommand.info.path.join(' '), request.rawArgs),
      );

      return {
        effect: prepared.effect,
        run: () => prepared.run(request.context.feature, makeEmit(request.session, request.trace)),
      };
    })
    .exhaustive();
}

function getPrepared<Prepared>(result: ArgsResult<Prepared>): Prepared {
  if (!result.ok) {
    throw new WringerError('usage', { message: result.message });
  }

  return result.prepared;
}

function buildBuiltinContext(request: CommandRequest, hint: string): BuiltinContext {
  return {
    wringer: request.wringer,
    state: request.state,
    session: request.session,
    stateDir: request.stateDir,
    targetName: request.context.targetName,
    target: request.context.target,
    run: request.context.run,
    feature: request.context.feature,
    signal: request.deadline,
    deadlineAt: request.deadlineAt,
    now: request.now,
    wait: request.session.wait ?? ((delayMs) => Bun.sleep(delayMs)),
    emit: makeEmit(request.session, request.trace),
    openDrive: (access, deadline) => {
      const drive = openRunDrive(request, {
        run: getRunningRun(request.context.run),
        access,
        hint,
        deadline,
      });

      request.trace.evidence.push(drive.evidence);

      return drive;
    },
    bindRun: (runID) => {
      request.trace.boundRun = runID;
    },
    keepLate: (work) => {
      request.trace.late.push(work);
    },
  };
}

function getRunningRun(run: RunView | undefined): RunView {
  if (run === undefined) {
    throw new WringerError('not-running', { message: 'The target has no running run.' });
  }

  return run;
}

function getDrive(drive: Drive | undefined): Drive {
  if (drive === undefined) {
    throw new WringerError('not-running', { message: 'The command needs a running run.' });
  }

  return drive;
}

// A bound run whose log cannot be read leaves the envelope to the run the pointers name.
async function readBoundRun(state: StatePort, runID: RunID | null): Promise<RunView | null> {
  if (runID === null) {
    return null;
  }

  try {
    const view = await state.readRun(runID);

    return view ?? null;
  } catch {
    return null;
  }
}

async function readEnvelopeCursors(
  state: StatePort,
  runID: RunID,
): Promise<Record<string, number> | WringerError> {
  try {
    return await state.readCursors(runID);
  } catch (error) {
    return toWringerError(error);
  }
}

async function waitForLate(works: readonly Promise<void>[]): Promise<void> {
  await Promise.all(works);
}
