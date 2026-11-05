import { dirname } from 'node:path';
import { createActor, waitFor } from 'xstate';
import { buildRunHandle } from './build-run-handle.ts';
import { buildShutDownSteps } from './build-shut-down-steps.ts';
import type { StatePort } from './create-file-state.ts';
import { findOwnValue } from './find-own-value.ts';
import { getTarget } from './get-target.ts';
import { defaultRefusalHint } from './make-fence.ts';
import { raceDeadline } from './race-deadline.ts';
import type { LaunchHost } from './read-launch-host.ts';
import type { Endpoints, RunEvent } from './run-events.ts';
import { startLaunch } from './start-launch.ts';
import type { Launch } from './start-launch.ts';
import { startServices } from './start-services.ts';
import { supervisorMachine } from './supervisor-machine.ts';
import type { ShutDownPlan } from './supervisor-machine.ts';
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

type Cleanup = readonly [string, () => Promise<void>];

// The supervisor owns a run's app and every driver service. It resolves once the run has stopped,
// by `stop` over the socket or by a crash of the app. Its lifecycle is the supervisor machine; the
// functions here are the I/O the machine runs.
export async function runSupervisor(options: SupervisorOptions): Promise<void> {
  const target = getTarget(options.wringer, options.target);
  const run = buildRunHandle(options.state.paths.root, options.runID);

  const socket = await options.launchHost.createSocketFolder(run.paths.socket);

  const services = new Map<string, ServiceInstance>();
  const lifetime = new AbortController();
  const serviceCommands = new AbortController();

  const append = (event: RunEvent): Promise<void> =>
    options.state.appendEvent(options.runID, event);

  const at = (): string => options.now().toISOString();
  let launch: Launch | undefined;

  const stoppedKeys = new Set<string>();

  // Stops each part of the run that is up and not yet stopping, and names each that failed. A part
  // is marked before its stop starts, so two calls never stop the same part. The app stops first,
  // so a service that records its log, such as a stream recorder, sees its last lines.
  const stopStarted = async (): Promise<readonly string[]> => {
    const current = launch;

    const appCleanups: readonly Cleanup[] =
      current === undefined ? [] : [['app', () => current.stop()]];

    const serviceCleanups = [...services].map(([key, service]): Cleanup => [
      key,
      () => service.stop(),
    ]);

    const appPending = appCleanups.filter(([key]) => !stoppedKeys.has(key));
    const servicePending = serviceCleanups.filter(([key]) => !stoppedKeys.has(key));

    for (const [key] of [...appPending, ...servicePending]) {
      stoppedKeys.add(key);
    }

    const appFailures = await runCleanups(appPending, options.stopWaitMs);
    const serviceFailures = await runCleanups(servicePending, options.stopWaitMs);

    return [...appFailures, ...serviceFailures];
  };

  // Every cleanup runs, even after one fails, and the supervisor ends even when the final log write
  // fails. A failed cleanup or log write goes to the stop's caller, as a part may still be up.
  const shutDown = async (plan: ShutDownPlan): Promise<WringerError | null> => {
    const failures = await stopStarted();

    const steps = buildShutDownSteps({ ...plan, failures, at: at() });

    if (steps.abortCommands) {
      serviceCommands.abort();
    }

    try {
      for (const event of steps.events) {
        await append(event);
      }

      await options.state.writeManifest(options.runID);
    } catch (error) {
      const failure = toWringerError(error);

      // A stop that a crash or a signal began has no caller to take the failure.
      options.reportError(`The run's final log write failed: ${failure.message}`);

      return failure;
    }

    return steps.failure;
  };

  // The run's log is already closed, so a late part's failure goes to the supervisor's own log.
  const cleanUpLate = async (): Promise<void> => {
    for (const failure of await stopStarted()) {
      options.reportError(`A late cleanup failed for ${failure}`);
    }

    serviceCommands.abort();
  };

  // A failed first write stops the run like any startup failure, so the socket still closes.
  const startUp = async (): Promise<void> => {
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
  };

  const lifecycle = createActor(supervisorMachine, {
    input: {
      stopWaitMs: options.stopWaitMs,
      startUp,
      abortStartup: () => {
        lifetime.abort();
      },
      shutDown,
      cleanUpLate,
    },
  });

  const waitForClosed = () =>
    waitFor(lifecycle, (snapshot) => snapshot.hasTag('closed'), { timeout: Infinity });

  // A second stop, such as a `down` while a crash is still stopping the run, waits for the first.
  const stop = async (crashReason: string | null): Promise<WringerError | null> => {
    lifecycle.send({ type: 'stop', reason: crashReason });

    const closed = await waitForClosed();

    return closed.context.failure;
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

  const server = await options.launchHost.listenSupervisorSocket({
    path: socket,
    answerRequest,
    onTransportError: (error) => {
      options.reportError(`The supervisor socket failed: ${toWringerError(error).message}`);
    },
  });

  // The startup writes the socket into the run's log, so it starts once the socket listens.
  lifecycle.start();

  const onSignal = (): void => {
    void stop('the supervisor was signalled to stop');
  };

  options.signal?.addEventListener('abort', onSignal, { once: true });

  // A signal that came while the socket opened fired before the listener, which never sees it.
  if (options.signal?.aborted === true) {
    onSignal();
  }

  await waitForClosed();

  await server.close(options.stopWaitMs);
  await options.launchHost.removeDirectory(dirname(socket));
}

// Each cleanup runs, even after one fails, and each failure names its part.
async function runCleanups(cleanups: readonly Cleanup[], stopWaitMs: number): Promise<string[]> {
  const settled = await Promise.allSettled(
    cleanups.map(([, cleanup]) =>
      raceDeadline(Promise.try(cleanup), AbortSignal.timeout(stopWaitMs)),
    ),
  );

  return settled.flatMap((result, index) =>
    result.status === 'rejected'
      ? [`${cleanups[index]?.[0] ?? 'unknown'}: ${toWringerError(result.reason).message}`]
      : [],
  );
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
