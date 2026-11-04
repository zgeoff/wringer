import { join } from 'node:path';
import { match } from 'ts-pattern';
import { buildEnvelope } from './build-envelope.ts';
import type { RunView } from './build-run-view.ts';
import { buildRunPaths } from './build-state-paths.ts';
import { createEvidenceWriter } from './create-evidence-writer.ts';
import { createFileState } from './create-file-state.ts';
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
import { readCursors } from './read-cursors.ts';
import { readDefaultBase } from './read-default-base.ts';
import { readFingerprint } from './read-fingerprint.ts';
import { readHeadSHA } from './read-head-sha.ts';
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
const lockTimeoutMs = 30_000;

interface CommandOutcome {
  readonly data: unknown;
  readonly evidence: readonly Evidence[];
  readonly drive: boolean;
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
  const state = createFileState({ stateDir, lockTimeoutMs });

  const read = await readContext(wringer, state, session).catch((error: unknown) =>
    toWringerError(error),
  );

  const before = read instanceof WringerError ? null : read;
  let outcome: CommandOutcome | null = null;
  let failure: WringerError | null = null;

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
    });

    outcome = await raceDeadline(work, deadline);
  } catch (error) {
    failure = toWringerError(error);
  }

  const after = await readContext(wringer, state, session).catch(() => before);

  const run = after?.run ?? before?.run;
  const feature = after?.feature ?? null;

  const capped = await capData(outcome?.data, {
    root: session.root,
    directory:
      run === undefined
        ? join(stateDir, 'payloads')
        : join(buildRunPaths(stateDir, run.runID).features, feature ?? unassignedFeature),
    now,
  });

  const sha = await readHeadSHA(session.root);

  const cursors =
    run === undefined ? {} : await readCursors(buildRunPaths(stateDir, run.runID).streams);

  const envelope = buildEnvelope({
    command: path.join('.'),
    target: after?.targetName ?? null,
    instance: run?.runID ?? null,
    feature,
    sha,
    durationMs: performance.now() - startedMs,
    data: pickEnvelopeData(capped.data, failure),
    evidence: [...(outcome?.evidence ?? []), ...capped.evidence],
    cursors,
    truncatedPath: capped.truncatedPath,
    error: failure,
  });

  if (run !== undefined) {
    await logEnvelope(state, run, envelope, { drive: outcome?.drive === true, failure, now });
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

  const drive =
    needsRun && context.run !== undefined
      ? openRunDrive(request, context.run, context.target.access, hint)
      : undefined;

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

  const data = await prepared.run();

  const output = info.data.safeParse(data);

  if (!output.success) {
    throw new WringerError('internal', {
      message: `${commandText} returned data that does not match its schema: ${output.error.message}`,
      data: { stack: output.error.stack ?? output.error.message },
    });
  }

  return {
    data: output.data,
    evidence: drive?.evidence ?? [],
    drive: needsRun && needsDoctor,
  };
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

function openRunDrive(request: CommandRequest, run: RunView, access: Access, hint: string): Drive {
  return openDrive({
    wringer: request.wringer,
    root: request.session.root,
    stateDir: request.stateDir,
    targetName: request.context.targetName,
    target: request.context.target,
    access,
    hint,
    run,
    feature: request.context.feature,
    signal: request.deadline,
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
    openDrive: (access) => openRunDrive(request, getRunningRun(request.context.run), access, hint),
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

export const dataCapBytes = 32 * 1024;

interface CapRequest {
  readonly root: string;
  readonly directory: string;
  readonly now: () => Date;
}

interface CappedData {
  readonly data: unknown;
  readonly evidence: readonly Evidence[];
  readonly truncatedPath: string | null;
}

// Over the cap, the full data goes to an evidence file and the envelope carries its path.
async function capData(data: unknown, request: CapRequest): Promise<CappedData> {
  const text = JSON.stringify(data ?? null);

  if (Buffer.byteLength(text) <= dataCapBytes) {
    return { data, evidence: [], truncatedPath: null };
  }

  const evidence = await createEvidenceWriter(request).writer.writeFile(
    'payload',
    'payload.json',
    text,
  );

  return { data: null, evidence: [evidence], truncatedPath: evidence.path };
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
      stack: readStack(request.failure.data),
    });
  }

  await state.appendEvent(run.runID, {
    type: 'envelope',
    at,
    drive: request.drive && envelope.ok,
    envelope,
  });
}

function readStack(data: unknown): string {
  if (
    typeof data === 'object' &&
    data !== null &&
    'stack' in data &&
    typeof data.stack === 'string'
  ) {
    return data.stack;
  }

  return '';
}
