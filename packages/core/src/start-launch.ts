import { dirname } from 'node:path';
import { buildSpawnError } from './build-spawn-error.ts';
import type { AppProcess, AppSpawnOptions, LaunchHost } from './read-launch-host.ts';
import { readStreamLines } from './read-stream-lines.ts';
import type { Endpoints } from './run-events.ts';
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
}

export interface Launch {
  readonly endpoints: Endpoints;
  readonly stop: () => Promise<void>;
}

const stopGraceMs = 5000;

// The app runs in a process group of its own, and every stop signals the whole group, so a server
// that a shell or a script runner started stops with it.
export async function startLaunch(request: LaunchRequest): Promise<Launch> {
  const cwd = request.plan.cwd ?? request.host.cwd;

  await createLogFolder(request.host, request.logPath);

  // The abort listener below never fires for a run that stopped already, so the app would start.
  if (request.signal.aborted) {
    throw new WringerError('environment', { message: 'The run stopped before the app was ready.' });
  }

  const child = spawnApp(request.host, [...request.host.guard, ...request.plan.command], {
    cwd,
    env: { ...request.host.env, ...request.plan.env },
  });

  const ready = Promise.withResolvers<Endpoints>();
  let stopping = false;

  // Each failure after the start, the app's exit or a lost log, ends the run once.
  const crash = (reason: string): void => {
    ready.reject(new WringerError('environment', { message: reason }));

    if (!stopping) {
      stopping = true;

      request.onCrash(reason);
    }
  };

  const timer = setTimeout(() => {
    ready.reject(
      new WringerError('timeout', {
        message: `The app printed no ready line within ${request.readyTimeoutMs} ms.`,
      }),
    );
  }, request.readyTimeoutMs);

  const onAbort = (): void => {
    ready.reject(
      new WringerError('environment', { message: 'The run stopped before the app was ready.' }),
    );
  };

  request.signal.addEventListener('abort', onAbort, { once: true });

  const pumpLog = async (
    stream: ReadableStream<Uint8Array>,
    onLine: (line: string) => void,
  ): Promise<void> => {
    try {
      await pipeLines(request.host, stream, request.logPath, onLine);
    } catch (error) {
      crash(`The app's output could not be logged: ${toWringerError(error).message}`);
    }
  };

  void pumpLog(child.stdout, (line) => {
    const endpoints = request.plan.ready(parseLogLine(line));

    if (endpoints !== null) {
      ready.resolve(endpoints);
    }
  });

  void pumpLog(child.stderr, () => {
    // The log keeps stderr; only stdout carries the ready line.
  });

  const watchExit = async (): Promise<void> => {
    const exitCode = await child.exited;

    // A child the app started may outlive it; nothing else would stop it.
    request.host.killProcessGroup(child.pid);

    crash(`The app exited with code ${exitCode}.`);
  };

  void watchExit();

  const stop = async (): Promise<void> => {
    stopping = true;

    if (request.plan.stop !== undefined) {
      await runStopCommand(request.host, request.plan.stop, cwd);
    }

    request.host.killProcessGroup(child.pid, 'SIGTERM');

    const forced = setTimeout(() => {
      request.host.killProcessGroup(child.pid);
    }, stopGraceMs);

    await child.exited;

    clearTimeout(forced);

    request.host.killProcessGroup(child.pid);
  };

  try {
    const endpoints = await ready.promise;

    return { endpoints, stop };
  } catch (error) {
    await stop();

    throw error;
  } finally {
    request.signal.removeEventListener('abort', onAbort);

    clearTimeout(timer);
  }
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

async function pipeLines(
  host: LaunchHost,
  stream: ReadableStream<Uint8Array>,
  logPath: string,
  onLine: (line: string) => void,
): Promise<void> {
  for await (const line of readStreamLines(stream)) {
    await host.appendLog(logPath, `${line}\n`);

    onLine(line);
  }
}

function parseLogLine(line: string): Readonly<Record<string, unknown>> {
  try {
    const parsed: unknown = JSON.parse(line);

    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed))
      : { message: line };
  } catch {
    return { message: line };
  }
}

// A stop command that fails or hangs must not keep the app alive, so it gets the grace period and
// its failure is dropped: the SIGTERM and SIGKILL that follow end the app whatever it did.
async function runStopCommand(
  host: LaunchHost,
  argv: readonly string[],
  cwd: string,
): Promise<void> {
  try {
    await host.runProcess({ argv, cwd, signal: AbortSignal.timeout(stopGraceMs) });
  } catch {
    // Dropped on purpose; see above.
  }
}
