import { join } from 'node:path';
import { match } from 'ts-pattern';
import { buildEnvelope } from './build-envelope.ts';
import type { EnvelopeInput } from './build-envelope.ts';
import type { RunView } from './build-run-view.ts';
import { buildRunPaths } from './build-state-paths.ts';
import { capData } from './cap-data.ts';
import type { StatePort } from './create-file-state.ts';
import { decideGuard } from './decide-guard.ts';
import { envelopeVersion } from './envelope-version.ts';
import type { Envelope, Evidence } from './envelope.ts';
import { exitCodeFor } from './error-codes.ts';
import type { ExitCode } from './error-codes.ts';
import { getTarget } from './get-target.ts';
import type { Access } from './host.ts';
import { defaultRefusalHint } from './make-fence.ts';
import { openDrive, unassignedFeature } from './open-drive.ts';
import { openRunlessDrive } from './open-runless-drive.ts';
import { readDefaultBase } from './read-default-base.ts';
import { readFingerprint } from './read-fingerprint.ts';
import { readHeadSHA } from './read-head-sha.ts';
import type { RunID } from './run-events.ts';
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
  const trace: DriveTrace = { evidence: [], drive: false };

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

  // A drive belongs to the run and feature it ran under, even when another command moved the
  // pointers meanwhile; any other command reports the state it left, such as the run `up` started.
  const after = await readContext(wringer, state, session).catch(() => before);

  const settled = trace.drive ? before : after;
  const run = pickEnvelopeRun(before, settled);
  const feature = settled?.feature ?? null;
  const cursorsRead = run === undefined ? {} : await readEnvelopeCursors(state, run.runID);
  const cursors = cursorsRead instanceof WringerError ? {} : cursorsRead;

  if (failure === null && cursorsRead instanceof WringerError) {
    failure = cursorsRead;
  }

  const capped = await capData(pickEnvelopeData(outcome?.data, failure), {
    root: session.root,
    directory:
      run === undefined
        ? join(stateDir, 'payloads')
        : join(buildRunPaths(stateDir, run.runID).features, feature ?? unassignedFeature),
    now,
  });

  if (failure === null && capped.failure !== null) {
    failure = capped.failure;
  }

  const sha = await readHeadSHA(session.root);

  const input: EnvelopeInput = {
    command: path.join('.'),
    target: settled?.targetName ?? null,
    instance: run?.runID ?? null,
    feature,
    sha,
    durationMs: performance.now() - startedMs,
    data: capped.data,
    evidence: [...trace.evidence.flat(), ...capped.evidence],
    cursors,
    truncatedPath: capped.truncatedPath,
    error: failure,
  };

  const envelope = buildEnvelope(input);

  const logFailure =
    run === undefined
      ? null
      : await writeEnvelopeLog(state, run, envelope, { drive: trace.drive, failure, now });

  if (logFailure !== null) {
    return {
      envelope: buildEnvelope({ ...input, data: null, truncatedPath: null, error: logFailure }),
      exitCode: exitCodeFor[logFailure.code],
    };
  }

  return { envelope, exitCode: failure === null ? 0 : exitCodeFor[failure.code] };
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
  const pointers = await state.readPointers();

  const [firstTarget = ''] = wringer.targets.keys();
  const targetName = session.target ?? pointers.target ?? firstTarget;
  const target = getTarget(wringer, targetName);
  const runID = pointers.currentRun[targetName];
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

  const hint = context.target.refusalHint ?? defaultRefusalHint;
  const drive = openCommandDrive(request, { needsRun, hint });
  const prepared = prepareCommand(request, drive, hint);
  const commandText = `\`${info.path.join(' ')}\``;

  if (
    request.command.kind === 'repo' &&
    request.command.targets !== undefined &&
    !request.command.targets.includes(context.targetName)
  ) {
    throw new WringerError('target-not-allowed', {
      message: `${commandText} runs only on ${request.command.targets.join(', ')}.`,
    });
  }

  if (context.target.access === 'read-only' && prepared.effect !== 'read') {
    throw new WringerError('read-only', {
      message: `${commandText} is a write, and target ${context.targetName} is read-only.`,
      hint,
    });
  }

  // A drive's evidence list grows as the command runs; the trace holds the same list, one per drive.
  if (drive !== undefined) {
    request.trace.evidence.push(drive.evidence);
  }

  request.trace.drive = needsRun && needsDoctor;

  const data = await prepared.run();

  const output = info.data.safeParse(data);

  if (!output.success) {
    throw new WringerError('internal', {
      message: `${commandText} returned data that does not match its schema: ${output.error.message}`,
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

  const fingerprint = await readFingerprint({
    cwd: request.session.root,
    base,
    exclude: [request.wringer.stateDir],
  });

  return fingerprint !== run.fingerprint;
}

interface CommandDriveOptions {
  readonly needsRun: boolean;
  readonly hint: string;
}

// A command that needs a run drives it; a repo command that needs none gets a drive with no run;
// a built-in or driver command that needs none reaches no drive.
function openCommandDrive(
  request: CommandRequest,
  options: CommandDriveOptions,
): Drive | undefined {
  const run = request.context.run;
  const access = request.context.target.access;
  const repo = request.command.kind === 'repo';

  // A repo command that needs no run still reaches the run's services while one is running.
  if (run !== undefined && (options.needsRun || (repo && run.status === 'running'))) {
    return openRunDrive(request, { run, access, hint: options.hint });
  }

  if (!options.needsRun && repo) {
    return openRunlessDrive({
      wringer: request.wringer,
      root: request.session.root,
      stateDir: request.stateDir,
      targetName: request.context.targetName,
      target: request.context.target,
      access,
      hint: options.hint,
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

async function raceDeadline<T>(work: Promise<T>, deadline: AbortSignal): Promise<T> {
  const aborted = Promise.withResolvers<T>();

  const onAbort = (): void => {
    aborted.reject(new WringerError('timeout'));
  };

  deadline.addEventListener('abort', onAbort, { once: true });

  try {
    return await Promise.race([work, aborted.promise]);
  } finally {
    deadline.removeEventListener('abort', onAbort);
  }
}

// `down` clears the pointer to the run it ended, so its envelope names that run from before the
// command. A command that moved to another target names only that target's run.
function pickEnvelopeRun(
  before: CommandContext | null,
  settled: CommandContext | null,
): RunView | undefined {
  if (settled?.targetName !== before?.targetName) {
    return settled?.run;
  }

  return settled?.run ?? before?.run;
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

// A failed command's envelope carries the data its error gives, such as the doctor's results; an
// internal error's data is its stack, which goes to the run's log instead.
function pickEnvelopeData(data: unknown, failure: WringerError | null): unknown {
  if (failure === null) {
    return data;
  }

  return failure.code === 'internal' ? null : failure.data;
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
