import { join } from 'node:path';
import { match } from 'ts-pattern';
import { buildEnvelope } from './build-envelope.ts';
import type { RunView } from './build-run-view.ts';
import { buildRunPaths } from './build-state-paths.ts';
import { capData } from './cap-data.ts';
import type { StatePort } from './create-file-state.ts';
import { decideGuard } from './decide-guard.ts';
import { envelopeVersion } from './envelope-version.ts';
import type { Envelope, Evidence } from './envelope.ts';
import { exitCodeFor } from './error-codes.ts';
import type { ExitCode } from './error-codes.ts';
import { findOwnValue } from './find-own-value.ts';
import { getTarget } from './get-target.ts';
import type { Access } from './host.ts';
import { defaultRefusalHint } from './make-fence.ts';
import { openDrive, unassignedFeature } from './open-drive.ts';
import { openRunlessDrive } from './open-runless-drive.ts';
import { pickAccessRefusal } from './pick-access-refusal.ts';
import { pickDriveKind } from './pick-drive-kind.ts';
import type { DriveKind } from './pick-drive-kind.ts';
import { pickEnvelopeContext } from './pick-envelope-context.ts';
import { pickEnvelopePayload } from './pick-envelope-payload.ts';
import { pickEnvelopeRun } from './pick-envelope-run.ts';
import { raceDeadline } from './race-deadline.ts';
import { readDefaultBase } from './read-default-base.ts';
import { readFingerprint } from './read-fingerprint.ts';
import { readHeadSHA } from './read-head-sha.ts';
import type { RunID } from './run-events.ts';
import { settleEnvelope } from './settle-envelope.ts';
import { toWringerError } from './to-wringer-error.ts';
import type {
  ArgsResult,
  BuiltinContext,
  Drive,
  Effect,
  Emit,
  RegisteredCommand,
  Session,
  TargetDefinition,
  Wringer,
} from './types.ts';
import { WringerError } from './wringer-error.ts';

export interface DispatchResult {
  readonly envelope: Envelope;
  readonly exitCode: ExitCode;
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

  const read = await readContext(wringer, state, session).catch((error: unknown) =>
    toWringerError(error),
  );

  const before = read instanceof WringerError ? null : read;
  let outcome: CommandOutcome | null = null;
  let failure: WringerError | null = null;
  const trace: DriveTrace = { evidence: [], drive: false, ranOnRun: false, boundRun: null };

  try {
    if (read instanceof WringerError) {
      throw read;
    }

    const context = read;
    const command = wringer.commands.get(path.join(' '));

    if (command === undefined) {
      throw new WringerError('usage', { message: `There is no command \`${path.join(' ')}\`.` });
    }

    const deadline = AbortSignal.timeout(
      session.timeoutMs ?? command.info.timeoutMs ?? defaultTimeoutMs,
    );

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
      trace,
    });

    outcome = await raceDeadline(work, deadline);
  } catch (error) {
    failure = toWringerError(error);
  }

  const after = await readContext(wringer, state, session).catch(() => before);
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
  });

  const input = settleEnvelope({
    command: path.join('.'),
    target: settled?.targetName ?? null,
    instance: run?.runID ?? null,
    feature,
    sha: await readHeadSHA(session.root),
    durationMs: performance.now() - startedMs,
    driveEvidence: trace.evidence.flat(),
    payload,
    capped,
  });

  const envelope = buildEnvelope(input);

  const logFailure =
    run === undefined
      ? null
      : await writeEnvelopeLog(state, run, envelope, {
          drive: trace.drive,
          failure: input.error,
          now,
        });

  if (logFailure !== null) {
    return {
      envelope: buildEnvelope({ ...input, data: null, truncatedPath: null, error: logFailure }),
      exitCode: exitCodeFor[logFailure.code],
    };
  }

  return { envelope, exitCode: input.error === null ? 0 : exitCodeFor[input.error.code] };
}

interface CommandContext {
  readonly targetName: string;
  readonly target: TargetDefinition;
  readonly run: RunView | undefined;
  readonly feature: string | null;
}

async function readContext(
  wringer: Wringer,
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

  const [firstTarget = ''] = wringer.targets.keys();
  const targetName = session.target ?? pointers.target ?? firstTarget;
  const target = getTarget(wringer, targetName);
  const runID = findOwnValue(pointers.currentRun, targetName);
  const run = runID === undefined ? undefined : await state.readRun(runID);

  return { targetName, target, run, feature: session.feature ?? pointers.feature ?? null };
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
  readonly trace: DriveTrace;
}

async function runCommand(request: CommandRequest): Promise<CommandOutcome> {
  const info = request.command.info;
  const context = request.context;
  const needsRun = info.needsRun ?? request.command.kind !== 'builtin';
  const needsDoctor = info.needsDoctor ?? request.command.kind !== 'builtin';

  const fingerprintChanged = await probeFingerprintChanged(request, needsDoctor);

  const refusal = decideGuard({
    needsRun,
    needsDoctor,
    run: context.run,
    targetName: context.targetName,
    mode: context.target.mode,
    fingerprintChanged,
  });

  if (refusal !== null) {
    throw refusal;
  }

  // The envelope answers at the deadline without waiting for this function, so a body that would
  // start after it never starts.
  if (request.deadline.aborted) {
    throw new WringerError('timeout');
  }

  const hint = context.target.refusalHint ?? defaultRefusalHint;

  const driveKind = pickDriveKind({
    runStatus: context.run?.status ?? null,
    needsRun,
    isRepoCommand: request.command.kind === 'repo',
  });

  const drive = openCommandDrive(request, driveKind, hint);
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

  request.trace.drive = needsRun && needsDoctor;
  request.trace.ranOnRun = driveKind === 'run';

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

// A launched app runs this worktree's code, so a drive on it needs the tree unchanged since launch.
async function probeFingerprintChanged(
  request: CommandRequest,
  needsDoctor: boolean,
): Promise<boolean> {
  const run = request.context.run;

  if (!needsDoctor || request.context.target.mode !== 'launch' || run?.doctor !== 'passed') {
    return false;
  }

  const base = await readDefaultBase(request.session.root);

  const fingerprint = await readFingerprint(request.session.fingerprintHost, {
    cwd: request.session.root,
    base,
    exclude: [request.wringer.stateDir],
  });

  return fingerprint !== run.fingerprint;
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
      emit: makeEmit(request.session),
    });
  }

  return undefined;
}

interface RunDriveOptions {
  readonly run: RunView;
  readonly access: Access;
  readonly hint: string;
  readonly signal?: AbortSignal | undefined;
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
    signal: options.signal ?? request.deadline,
    now: request.now,
    emit: makeEmit(request.session),
  });
}

function makeEmit(session: Session): Emit {
  return (event, data) => {
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
        run: () => prepared.run(request.context.feature, makeEmit(request.session)),
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
    now: request.now,
    emit: makeEmit(request.session),
    openDrive: (access, signal) => {
      const drive = openRunDrive(request, {
        run: getRunningRun(request.context.run),
        access,
        hint,
        signal,
      });

      request.trace.evidence.push(drive.evidence);

      return drive;
    },
    bindRun: (runID) => {
      request.trace.boundRun = runID;
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

interface LogRequest {
  readonly drive: boolean;
  readonly failure: WringerError | null;
  readonly now: () => Date;
}

// The command has already run, so a log write that fails, such as an event over the log's cap,
// still yields an envelope, one that carries the failure.
async function writeEnvelopeLog(
  state: StatePort,
  run: RunView,
  envelope: Envelope,
  request: LogRequest,
): Promise<WringerError | null> {
  try {
    await logEnvelope(state, run, envelope, request);

    return null;
  } catch (error) {
    return toWringerError(error);
  }
}

async function logEnvelope(
  state: StatePort,
  run: RunView,
  envelope: Envelope,
  request: LogRequest,
): Promise<void> {
  const at = request.now().toISOString();

  if (request.failure?.code === 'internal') {
    await state.appendEvent(run.runID, {
      type: 'internal-error',
      at,
      command: envelope.command,
      stack: parseStack(request.failure.data),
    });
  }

  await state.appendEvent(run.runID, {
    type: 'envelope',
    at,
    drive: request.drive && envelope.ok,
    envelope,
  });
}

// A stack this long is a runaway, and the log refuses an event past its cap.
const stackCapChars = 16 * 1024;

function parseStack(data: unknown): string {
  if (
    typeof data === 'object' &&
    data !== null &&
    'stack' in data &&
    typeof data.stack === 'string'
  ) {
    return data.stack.slice(0, stackCapChars);
  }

  return '';
}
