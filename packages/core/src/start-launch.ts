import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { readStreamLines } from './read-stream-lines.ts';
import type { Endpoints } from './run-events.ts';
import { runProcess } from './run-process.ts';
import type { LaunchPlan } from './types.ts';
import { WringerError } from './wringer-error.ts';

export interface LaunchRequest {
  readonly plan: LaunchPlan;
  readonly logPath: string;
  readonly readyTimeoutMs: number;
  readonly signal: AbortSignal;
  readonly onExit: (exitCode: number) => void;
}

export interface Launch {
  readonly endpoints: Endpoints;
  readonly stop: () => Promise<void>;
}

const stopGraceMs = 5000;

// setpriv asks the kernel to kill the app when the supervisor dies, so a crashed supervisor leaves
// no orphan behind. Hosts without setpriv, such as macOS, run the app without that guard.
export async function startLaunch(request: LaunchRequest): Promise<Launch> {
  const guard = Bun.which('setpriv') === null ? [] : ['setpriv', '--pdeathsig', 'KILL', '--'];
  const cwd = request.plan.cwd ?? process.cwd();

  const child = Bun.spawn([...guard, ...request.plan.command], {
    cwd,
    env: { ...process.env, ...request.plan.env },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const ready = Promise.withResolvers<Endpoints>();
  let stopping = false;

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

  await mkdir(dirname(request.logPath), { recursive: true });

  void pipeLines(child.stdout, request.logPath, (line) => {
    const endpoints = request.plan.ready(parseLogLine(line));

    if (endpoints !== null) {
      ready.resolve(endpoints);
    }
  });

  void pipeLines(child.stderr, request.logPath, () => {
    // The log keeps stderr; only stdout carries the ready line.
  });

  const watchExit = async (): Promise<void> => {
    const exitCode = await child.exited;

    ready.reject(
      new WringerError('environment', { message: `The app exited with code ${exitCode}.` }),
    );

    if (!stopping) {
      request.onExit(exitCode);
    }
  };

  void watchExit();

  const stop = async (): Promise<void> => {
    stopping = true;

    if (request.plan.stop !== undefined) {
      await runStopCommand(request.plan.stop, cwd);
    }

    child.kill('SIGTERM');

    const forced = setTimeout(() => {
      child.kill('SIGKILL');
    }, stopGraceMs);

    await child.exited;

    clearTimeout(forced);
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

async function pipeLines(
  stream: ReadableStream<Uint8Array>,
  logPath: string,
  onLine: (line: string) => void,
): Promise<void> {
  for await (const line of readStreamLines(stream)) {
    await appendFile(logPath, `${line}\n`);

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
async function runStopCommand(argv: readonly string[], cwd: string): Promise<void> {
  try {
    await runProcess({ argv, cwd, signal: AbortSignal.timeout(stopGraceMs) });
  } catch {
    // Dropped on purpose; see above.
  }
}
