import { dirname } from 'node:path';
import { match } from 'ts-pattern';
import type { Actor } from 'xstate';
import { createActor, waitFor } from 'xstate';
import type { AppStart } from './app-machine.ts';
import { appMachine } from './app-machine.ts';
import { buildSpawnError } from './build-spawn-error.ts';
import { createLogWriter } from './create-log-writer.ts';
import type { LogWriter } from './create-log-writer.ts';
import { parseLaunchLine } from './parse-launch-line.ts';
import { raceDeadline } from './race-deadline.ts';
import type { AppProcess, AppSpawnOptions, LaunchHost } from './read-launch-host.ts';
import { readStreamLineBatches } from './read-stream-line-batches.ts';
import type { Endpoints } from './run-events.ts';
import type { ProcessRequest } from './run-process.ts';
import { toWringerError } from './to-wringer-error.ts';
import type { LaunchPlan } from './types.ts';
import { WringerError } from './wringer-error.ts';

export interface LaunchRequest {
  readonly host: LaunchHost;
  readonly plan: LaunchPlan;
  readonly logPath: string;
  readonly readyTimeoutMs: number;
  readonly signal: AbortSignal;
  readonly onCrash: (reason: string) => void;

  // Takes why the stop of an app that never got ready failed, as the app may still be up.
  readonly onStopFailed: (reason: string) => void;

  // How long the stop command, then the app after SIGTERM, each get before the next step.
  readonly stopGraceMs: number;
}

export interface Launch {
  readonly endpoints: Endpoints;

  // Rejects when a part of the app may still be up, or when its output missed its log.
  readonly stop: () => Promise<void>;
}

export const appStopGraceMs = 5000;

// The app runs in a process group of its own, and every stop signals the whole group, so a server
// that a shell or a script runner started stops with it. The app machine decides each move; this
// function starts the process and feeds the machine what the process and its log do.
export async function startLaunch(request: LaunchRequest): Promise<Launch> {
  const cwd = request.plan.cwd ?? request.host.cwd;
  const env = { ...request.host.env, ...request.plan.env };

  await createLogFolder(request.host, request.logPath);

  // The abort listener below never fires for a run that stopped already, so the app would start.
  if (request.signal.aborted) {
    throw new WringerError('environment', { message: 'The run stopped before the app was ready.' });
  }

  const child = spawnApp(request.host, [...request.host.guard, ...request.plan.command], {
    cwd,
    env,
  });

  const logs = Promise.withResolvers<unknown>();

  const giveUpOnLog = new AbortController();

  const log = createLogWriter((text) => request.host.appendLog(request.logPath, text));

  const app = createActor(appMachine, {
    input: {
      readyTimeoutMs: request.readyTimeoutMs,
      reportCrash: request.onCrash,
      killGroup: () => {
        request.host.killProcessGroup(child.pid);
      },
      stopApp: () =>
        stopApp({
          host: request.host,
          plan: request.plan,
          cwd,
          env,
          child,
          logged: logs.promise,
          giveUpOnLog: () => {
            giveUpOnLog.abort();
          },
          closeLog: log.close,
          stopGraceMs: request.stopGraceMs,
        }),
    },
  });

  app.start();

  const onAbort = (): void => {
    app.send({ type: 'abort' });
  };

  request.signal.addEventListener('abort', onAbort, { once: true });

  const pumpLog = async (
    stream: ReadableStream<Uint8Array>,
    onLine: (line: string) => void,
  ): Promise<void> => {
    try {
      await pipeLines(log, stream, giveUpOnLog.signal, onLine);
    } catch (error) {
      app.send({ type: 'log.failed', reason: toWringerError(error).message });
    }
  };

  logs.resolve(
    Promise.all([
      pumpLog(child.stdout, (line) => {
        const endpoints = request.plan.ready(parseLaunchLine(line));

        if (endpoints !== null) {
          app.send({ type: 'ready', endpoints });
        }
      }),
      pumpLog(child.stderr, () => {
        // The log keeps stderr; only stdout carries the ready line.
      }),
    ]),
  );

  const watchExit = async (): Promise<void> => {
    const exitCode = await child.exited;

    app.send({ type: 'exited', exitCode });
  };

  void watchExit();

  const started = await waitForStart(app, request.signal, onAbort);

  const endpoints = match(started.start)
    .with({ kind: 'ready' }, (ready) => ready.endpoints)
    .with({ kind: 'failed' }, (failed) => {
      throw buildStartFailure(failed.failure, pickStopFailure(started), request.onStopFailed);
    })
    .with({ kind: 'pending' }, () => {
      throw new WringerError('internal', { message: 'The app settled before its start did.' });
    })
    .exhaustive();

  return {
    endpoints,
    stop: async () => {
      app.send({ type: 'stop' });

      const done = await waitFor(app, (snapshot) => snapshot.hasTag('done'), {
        timeout: Infinity,
      });

      const failure = pickStopFailure(done.context);

      if (failure !== null) {
        throw failure;
      }
    },
  };
}

async function createLogFolder(host: LaunchHost, logPath: string): Promise<void> {
  try {
    await host.createDirectory(dirname(logPath));
  } catch (error) {
    throw new WringerError('environment', {
      message: `The folder for the app log could not be created: ${String(error)}`,
    });
  }
}

function spawnApp(host: LaunchHost, argv: readonly string[], options: AppSpawnOptions): AppProcess {
  try {
    return host.spawnApp(argv, options);
  } catch (error) {
    throw buildSpawnError(argv.join(' '), error);
  }
}

interface AppStop {
  readonly host: LaunchHost;
  readonly plan: LaunchPlan;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly child: AppProcess;
  readonly logged: Promise<unknown>;

  // Releases the app's pipes, which a process outside its group may still hold.
  readonly giveUpOnLog: () => void;
  readonly closeLog: () => Promise<void>;
  readonly stopGraceMs: number;
}

// A failed stop still closes the log, so a service that reads the log once the stop settles, such
// as a stream recorder, reads its last line.
async function stopApp(stop: AppStop): Promise<void> {
  try {
    await signalApp(stop);
  } finally {
    await stop.closeLog();
  }
}

const logDrainMs = 2000;

// The longest a stop takes: the stop command's grace, the app's grace before SIGKILL, then the
// drain of its log.
export const appStopLimitMs = 2 * appStopGraceMs + logDrainMs;

// A hung stop command gives way to SIGTERM after the grace, and SIGKILL another grace later. The
// stop ends once the app's last lines reach its log; a process outside the group can hold the
// pipes open, so that wait has a bound.
async function signalApp(stop: AppStop): Promise<void> {
  if (stop.plan.stop !== undefined) {
    const stopping = runStopCommand(stop.host, {
      argv: stop.plan.stop,
      cwd: stop.cwd,
      env: stop.env,
      signal: AbortSignal.timeout(stop.stopGraceMs),
    });

    await Promise.allSettled([raceDeadline(stopping, AbortSignal.timeout(stop.stopGraceMs))]);
  }

  stop.host.killProcessGroup(stop.child.pid, 'SIGTERM');

  const forced = setTimeout(() => {
    stop.host.killProcessGroup(stop.child.pid);
  }, stop.stopGraceMs);

  await stop.child.exited;

  clearTimeout(forced);

  stop.host.killProcessGroup(stop.child.pid);

  const [drained] = await Promise.allSettled([
    raceDeadline(stop.logged, AbortSignal.timeout(logDrainMs)),
  ]);

  if (drained.status === 'rejected') {
    stop.giveUpOnLog();

    throw new WringerError('environment', {
      message: `The app's output still had not reached its log ${logDrainMs} ms after it exited.`,
      hint: 'A process the app started outside its process group may still hold its output open.',
    });
  }
}

// A failed stop command must not keep the app alive, so its failure is dropped: the SIGTERM and
// SIGKILL that follow end the app whatever it did.
async function runStopCommand(host: LaunchHost, request: ProcessRequest): Promise<void> {
  try {
    await host.runProcess(request);
  } catch {
    // Dropped on purpose; see above.
  }
}

async function pipeLines(
  log: LogWriter,
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onLine: (line: string) => void,
): Promise<void> {
  // One append per chunk: an app that prints many lines as it stops would otherwise pay one
  // append per line, and miss the bound on the stop's wait for its log.
  for await (const lines of readStreamLineBatches(stream, signal)) {
    await log.append(`${lines.join('\n')}\n`);

    for (const line of lines) {
      onLine(line);
    }
  }
}

interface StartedApp {
  readonly start: AppStart;
  readonly logFailure: string | null;
  readonly stopFailure: WringerError | null;
}

async function waitForStart(
  app: Actor<typeof appMachine>,
  signal: AbortSignal,
  onAbort: () => void,
): Promise<StartedApp> {
  try {
    const started = await waitFor(app, (snapshot) => snapshot.hasTag('settled'), {
      timeout: Infinity,
    });

    return started.context;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

// The startup failure stays the error; a failed stop adds what may still hold the app, and goes to
// the caller on its own too.
function buildStartFailure(
  startFailure: WringerError,
  stopFailure: WringerError | null,
  onStopFailed: (reason: string) => void,
): WringerError {
  if (stopFailure === null) {
    return startFailure;
  }

  onStopFailed(stopFailure.message);

  return new WringerError(startFailure.code, {
    message: `${startFailure.message} ${stopFailure.message}`,
  });
}

interface StopOutcome {
  readonly logFailure: string | null;
  readonly stopFailure: WringerError | null;
}

// A failed stop names what may still be up; with none, output that missed the log still fails it.
function pickStopFailure(outcome: StopOutcome): WringerError | null {
  if (outcome.stopFailure !== null) {
    return outcome.stopFailure;
  }

  if (outcome.logFailure !== null) {
    return new WringerError('environment', {
      message: `The app's output could not be logged: ${outcome.logFailure}`,
    });
  }

  return null;
}
