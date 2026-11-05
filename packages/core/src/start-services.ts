import { buildServiceKey } from './build-service-key.ts';
import { collectDriverConfigs } from './collect-driver-configs.ts';
import { makeDriverExec } from './make-fenced-exec.ts';
import type { Endpoints } from './run-events.ts';
import type { RunHandle, ServiceInstance, TargetDefinition, Wringer } from './types.ts';

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

  const exec = makeDriverExec({
    host: request.target.host,
    access: request.target.access,
    hint: request.hint,
    signal: request.commandSignal,
  });

  for (const entry of entries) {
    for (const service of entry.serviceNames) {
      const instance = await entry.configured.startService(service, {
        target: request.targetName,
        access: request.target.access,
        endpoints: request.endpoints,
        run: request.run,
        host: request.target.host,
        exec,
        signal: request.signal,
      });

      const key = buildServiceKey(entry.name, service);

      // A service that came up after the abort still goes in `started`, so the stop reaches it.
      request.started.set(key, instance);
      request.signal.throwIfAborted();

      await request.onReady(key);
    }
  }
}
