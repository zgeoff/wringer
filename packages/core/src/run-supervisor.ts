import { dirname } from 'node:path';
import { buildRunHandle } from './build-run-handle.ts';
import type { StatePort } from './create-file-state.ts';
import { findOwnValue } from './find-own-value.ts';
import { getTarget } from './get-target.ts';
import { listenSupervisorSocket } from './listen-supervisor-socket.ts';
import { defaultRefusalHint } from './make-fence.ts';
import { raceDeadline } from './race-deadline.ts';
import type { LaunchHost } from './read-launch-host.ts';
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
  readonly launchHost: LaunchHost;
  readonly state: StatePort;
  readonly runID: string;
  readonly target: string;
  readonly readyTimeoutMs: number;

  // The longest a stop waits for a startup step, or for one cleanup, that ignores the abort.
  readonly stopWaitMs: number;
  readonly now: () => Date;
  readonly reportError: (message: string) => void;
  readonly signal?: AbortSignal | undefined;
}

// The supervisor owns a run's app and every driver service. It resolves once the run has stopped,
// by `stop` over the socket or by a crash of the app.
export async function runSupervisor(options: SupervisorOptions): Promise<void> {
  const target = getTarget(options.wringer, options.target);
  const run = buildRunHandle(options.state.paths.root, options.runID);

  const socket = await options.launchHost.createSocketFolder(run.paths.socket);

  const services = new Map<string, ServiceInstance>();
  const lifetime = new AbortController();
  const serviceCommands = new AbortController();

  const stopped = Promise.withResolvers<undefined>();

  const append = (event: RunEvent): Promise<void> =>
    options.state.appendEvent(options.runID, event);

  const at = (): string => options.now().toISOString();
  let launch: Launch | undefined;
  let stopping: Promise<WringerError | null> | undefined;
  const startup = Promise.withResolvers<undefined>();
  let startupSettled = false;
  let stopGaveUpOnStartup = false;

  const stoppedKeys = new Set<string>();

  // Stops each part of the run that is up and not yet stopping, and names each that failed. A part
  // is marked before its stop starts, so two calls never stop the same part.
  const stopStarted = async (): Promise<readonly string[]> => {
    const current = launch;

    const cleanups = [
      ...(current === undefined ? [] : [['app', () => current.stop()] as const]),
      ...[...services].map(([key, service]) => [key, () => service.stop()] as const),
    ].filter(([key]) => !stoppedKeys.has(key));

    for (const [key] of cleanups) {
      stoppedKeys.add(key);
    }

    const settled = await Promise.allSettled(
      cleanups.map(([, cleanup]) =>
        raceDeadline(Promise.try(cleanup), AbortSignal.timeout(options.stopWaitMs)),
      ),
    );

    return settled.flatMap((result, index) =>
      result.status === 'rejected'
        ? [`${cleanups[index]?.[0] ?? 'unknown'}: ${toWringerError(result.reason).message}`]
        : [],
    );
  };

  // A stop during startup waits a bounded time for the app and services still starting. Every
  // cleanup runs, even after one fails, and the supervisor ends even when the final log write
  // fails; that failure goes to the stop's caller.
  const shutDown = async (crashReason: string | null): Promise<WringerError | null> => {
    lifetime.abort();

    try {
      await raceDeadline(startup.promise, AbortSignal.timeout(options.stopWaitMs));
    } catch {
      stopGaveUpOnStartup = !startupSettled;
    }

    const failures = await stopStarted();

    // A cleanup the deadline gave up on can leave its command running, so the commands end only
    // once every part that will ever stop has stopped.
    if (!stopGaveUpOnStartup) {
      serviceCommands.abort();
    }

    try {
      for (const event of buildStopEvents({ crashReason, failures, at: at() })) {
        await append(event);
      }

      await options.state.writeManifest(options.runID);

      return null;
    } catch (error) {
      return toWringerError(error);
    } finally {
      stopped.resolve(undefined);
    }
  };

  // A second stop, such as a `down` while a crash is still stopping the run, waits for the first.
  const stop = (crashReason: string | null): Promise<WringerError | null> => {
    stopping ??= shutDown(crashReason);

    return stopping;
  };

  const answerRequest = async (request: SupervisorRequest): Promise<unknown> => {
    if (request.service === supervisorServiceName) {
      const failure = request.method === 'stop' ? await stop(null) : null;

      if (failure !== null) {
        throw failure;
      }

      return { pid: process.pid };
    }

    const methods = services.get(request.service)?.methods ?? {};
    const method = findOwnValue(methods, request.method);

    if (method === undefined) {
      throw new WringerError('usage', {
        message: `The run has no service call ${request.service} ${request.method}.`,
      });
    }

    return method(request.args);
  };

  const server = await listenSupervisorSocket({
    path: socket,
    answerRequest,
    onTransportError: (error) => {
      options.reportError(`The supervisor socket failed: ${toWringerError(error).message}`);
    },
  });

  const onSignal = (): void => {
    void stop('the supervisor was signalled to stop');
  };

  options.signal?.addEventListener('abort', onSignal, { once: true });

  // A signal that came while the socket opened fired before the listener, which never sees it.
  if (options.signal?.aborted === true) {
    onSignal();
  }

  const startAll = async (): Promise<void> => {
    // A failed first write stops the run like any startup failure, so the socket still closes.
    try {
      await append({ type: 'supervisor-ready', at: at(), pid: process.pid, socket });

      launch = await startTarget(target, {
        launchHost: options.launchHost,
        runDirectory: run.paths.directory,
        appLog: run.childLog('app').path,
        targetName: options.target,
        readyTimeoutMs: options.readyTimeoutMs,
        signal: lifetime.signal,
        onCrash: (reason) => {
          void stop(reason);
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
        commandSignal: serviceCommands.signal,
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
      startupSettled = true;

      startup.resolve(undefined);
    }

    // A part that came up after the stop stopped waiting for it still stops, and the run's log is
    // already closed, so its failure goes to the supervisor's own log.
    if (stopGaveUpOnStartup) {
      for (const failure of await stopStarted()) {
        options.reportError(`A late cleanup failed for ${failure}`);
      }

      serviceCommands.abort();
    }
  };

  void startAll();

  await stopped.promise;

  server.close();

  await options.launchHost.removeDirectory(dirname(socket));
}

interface StopOutcome {
  readonly crashReason: string | null;
  readonly failures: readonly string[];
  readonly at: string;
}

// A cleanup that failed makes the stop a crash, so the log names what may still run.
export function buildStopEvents(outcome: StopOutcome): readonly RunEvent[] {
  const reasons = [
    ...(outcome.crashReason === null ? [] : [outcome.crashReason]),
    ...(outcome.failures.length === 0 ? [] : [`cleanup failed for ${outcome.failures.join('; ')}`]),
  ];

  if (reasons.length === 0) {
    return [{ type: 'run-ended', at: outcome.at }];
  }

  return [{ type: 'crashed', at: outcome.at, reason: reasons.join('; ') }];
}

interface TargetStart {
  readonly launchHost: LaunchHost;
  readonly runDirectory: string;
  readonly appLog: string;
  readonly targetName: string;
  readonly readyTimeoutMs: number;
  readonly signal: AbortSignal;
  readonly onCrash: (reason: string) => void;
}

async function startTarget(target: TargetDefinition, start: TargetStart): Promise<Launch> {
  if (target.mode === 'launch') {
    return startLaunch({
      host: start.launchHost,
      plan: target.launch({ runDirectory: start.runDirectory }),
      logPath: start.appLog,
      readyTimeoutMs: start.readyTimeoutMs,
      signal: start.signal,
      onCrash: start.onCrash,
    });
  }

  if (target.endpoints === undefined) {
    return { endpoints: {}, stop: () => Promise.resolve() };
  }

  const endpoints: Endpoints = await target.endpoints({ target: start.targetName });

  return { endpoints, stop: () => Promise.resolve() };
}
