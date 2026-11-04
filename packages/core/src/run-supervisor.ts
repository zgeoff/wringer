import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRunHandle } from './build-run-handle.ts';
import type { StatePort } from './create-file-state.ts';
import { getTarget } from './get-target.ts';
import { listenSupervisorSocket } from './listen-supervisor-socket.ts';
import { defaultRefusalHint } from './make-fence.ts';
import type { Endpoints, RunEvent } from './run-events.ts';
import { startLaunch } from './start-launch.ts';
import type { Launch } from './start-launch.ts';
import { startServices } from './start-services.ts';
import { supervisorServiceName } from './supervisor-protocol.ts';
import type { SupervisorRequest } from './supervisor-protocol.ts';
import { toWringerError } from './to-wringer-error.ts';
import type { ServiceInstance, TargetDefinition, Wringer } from './types.ts';
import { WringerError } from './wringer-error.ts';

export interface SupervisorOptions {
  readonly wringer: Wringer;
  readonly state: StatePort;
  readonly runID: string;
  readonly target: string;
  readonly readyTimeoutMs: number;
  readonly now: () => Date;
  readonly signal?: AbortSignal | undefined;
}

// The supervisor owns a run's app and every driver service. It resolves once the run has stopped,
// by `stop` over the socket or by a crash of the app.
export async function runSupervisor(options: SupervisorOptions): Promise<void> {
  const target = getTarget(options.wringer, options.target);
  const run = buildRunHandle(options.state.paths.root, options.runID);
  const socket = pickSocketPath(run.paths.socket);

  const services = new Map<string, ServiceInstance>();
  const lifetime = new AbortController();

  const stopped = Promise.withResolvers<undefined>();

  const append = (event: RunEvent): Promise<void> =>
    options.state.appendEvent(options.runID, event);

  const at = (): string => options.now().toISOString();
  let launch: Launch | undefined;
  let stopping = false;
  const startup = Promise.withResolvers<undefined>();

  // A stop during startup waits for the app and services still starting, so it stops each one that
  // comes up late instead of leaving it running.
  const stop = async (crashReason: string | null): Promise<void> => {
    if (stopping) {
      return;
    }

    stopping = true;

    lifetime.abort();

    await startup.promise;

    await launch?.stop();
    await Promise.allSettled([...services.values()].map((service) => service.stop()));

    const ended: RunEvent =
      crashReason === null
        ? { type: 'run-ended', at: at() }
        : { type: 'crashed', at: at(), reason: crashReason };

    await append(ended);

    await options.state.writeManifest(options.runID);

    stopped.resolve(undefined);
  };

  const answerRequest = async (request: SupervisorRequest): Promise<unknown> => {
    if (request.service === supervisorServiceName) {
      if (request.method === 'stop') {
        await stop(null);
      }

      return { pid: process.pid };
    }

    const method = services.get(request.service)?.methods[request.method];

    if (method === undefined) {
      throw new WringerError('usage', {
        message: `The run has no service call ${request.service} ${request.method}.`,
      });
    }

    return method(request.args);
  };

  const server = await listenSupervisorSocket(socket, answerRequest);

  options.signal?.addEventListener(
    'abort',
    () => {
      void stop('the supervisor was signalled to stop');
    },
    { once: true },
  );

  await append({ type: 'supervisor-ready', at: at(), pid: process.pid, socket });

  try {
    launch = await startTarget(target, {
      runDirectory: run.paths.directory,
      appLog: run.childLog('app').path,
      targetName: options.target,
      readyTimeoutMs: options.readyTimeoutMs,
      signal: lifetime.signal,
      onExit: (exitCode) => {
        void stop(`the app exited with code ${exitCode}`);
      },
    });

    lifetime.signal.throwIfAborted();

    await append({ type: 'launch-ready', at: at(), endpoints: launch.endpoints });

    await startServices({
      wringer: options.wringer,
      targetName: options.target,
      target,
      endpoints: launch.endpoints,
      run,
      hint: target.refusalHint ?? defaultRefusalHint,
      signal: lifetime.signal,
      started: services,
      onReady: (key) => append({ type: 'service-ready', at: at(), service: key }),
    });

    lifetime.signal.throwIfAborted();

    await append({ type: 'run-ready', at: at() });

    await options.state.writeManifest(options.runID);
  } catch (error) {
    // Not awaited: the stop waits for `startup`, which resolves just below.
    void stop(toWringerError(error).message);
  } finally {
    startup.resolve(undefined);
  }

  await stopped.promise;

  server.close();

  await rm(socket, { force: true });
}

// Unix socket paths are capped near 108 bytes, so a deep worktree puts the socket in the temp
// folder under a hash of the path it would have had.
const maxSocketPathBytes = 100;

function pickSocketPath(path: string): string {
  if (Buffer.byteLength(path) <= maxSocketPathBytes) {
    return path;
  }

  const hash = new Bun.CryptoHasher('sha256').update(path).digest('hex').slice(0, 16);

  return join(tmpdir(), `wringer-${hash}.sock`);
}

interface TargetStart {
  readonly runDirectory: string;
  readonly appLog: string;
  readonly targetName: string;
  readonly readyTimeoutMs: number;
  readonly signal: AbortSignal;
  readonly onExit: (exitCode: number) => void;
}

async function startTarget(target: TargetDefinition, start: TargetStart): Promise<Launch> {
  if (target.mode === 'launch') {
    return startLaunch({
      plan: target.launch({ runDirectory: start.runDirectory }),
      logPath: start.appLog,
      readyTimeoutMs: start.readyTimeoutMs,
      signal: start.signal,
      onExit: start.onExit,
    });
  }

  if (target.endpoints === undefined) {
    return { endpoints: {}, stop: () => Promise.resolve() };
  }

  const endpoints: Endpoints = await target.endpoints({ target: start.targetName });

  return { endpoints, stop: () => Promise.resolve() };
}
