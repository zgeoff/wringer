import { buildServiceKey } from './build-service-key.ts';
import { collectDriverConfigs } from './collect-driver-configs.ts';
import { findCollidingServiceKey } from './find-colliding-service-key.ts';
import { makeDriverExec } from './make-fenced-exec.ts';
import type { Endpoints } from './run-events.ts';
import type { RunHandle, ServiceInstance, TargetDefinition, Wringer } from './types.ts';
import { WringerError } from './wringer-error.ts';

export interface ServicesRequest {
  readonly wringer: Wringer;
  readonly targetName: string;
  readonly target: TargetDefinition;
  readonly endpoints: Endpoints;
  readonly run: RunHandle;
  readonly hint: string;
  readonly signal: AbortSignal;

  // Ends the commands a service runs through its exec. It outlives `signal`, so a service's stop
  // can still run a command after the startup was cancelled.
  readonly commandSignal: AbortSignal;

  // Also ends the commands a service runs while it starts, once the stop gives up on the startup.
  readonly startupCommandSignal: AbortSignal;
  readonly started: Map<string, ServiceInstance>;
  readonly onReady: (key: string) => Promise<void>;
}

// Each service lands in `started` as soon as it is up, so a later failure still stops it.
export async function startServices(request: ServicesRequest): Promise<void> {
  const entries = collectDriverConfigs(request.wringer, request.target, {
    target: request.targetName,
    endpoints: request.endpoints,
    run: request.run,
  });

  // A second service under one key would replace the first in `started`, so no stop reaches it.
  const collision = findCollidingServiceKey(entries);

  if (collision !== null) {
    throw new WringerError('usage', {
      message: `Two driver services share the key ${collision}.`,
      hint: 'Rename a driver or a service, so each `<driver>/<service>` key names one service.',
    });
  }

  for (const entry of entries) {
    for (const service of entry.serviceNames) {
      const commands = makeServiceCommands(request);

      const exec = makeDriverExec({
        host: request.target.host,
        access: request.target.access,
        hint: request.hint,
        signal: commands.signal,
      });

      const instance = await entry.configured
        .startService(service, {
          target: request.targetName,
          access: request.target.access,
          endpoints: request.endpoints,
          run: request.run,
          host: request.target.host,
          exec,
          signal: request.signal,
        })
        .finally(commands.endStartup);

      const key = buildServiceKey(entry.name, service);

      // A service that came up after the abort still goes in `started`, so the stop reaches it.
      request.started.set(key, instance);
      request.signal.throwIfAborted();

      await request.onReady(key);
    }
  }
}

interface ServiceCommands {
  readonly signal: AbortSignal;

  // Detaches the startup signal once the service's start settles.
  readonly endStartup: () => void;
}

function makeServiceCommands(request: ServicesRequest): ServiceCommands {
  const commands = new AbortController();

  const end = (): void => {
    commands.abort();
  };

  for (const signal of [request.commandSignal, request.startupCommandSignal]) {
    signal.addEventListener('abort', end, { once: true });
  }

  if (request.commandSignal.aborted || request.startupCommandSignal.aborted) {
    end();
  }

  return {
    signal: commands.signal,
    endStartup: () => {
      request.startupCommandSignal.removeEventListener('abort', end);
    },
  };
}
