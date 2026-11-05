import { join } from 'node:path';
import { buildRunHandle } from './build-run-handle.ts';
import type { RunView } from './build-run-view.ts';
import { buildServiceKey } from './build-service-key.ts';
import { callSupervisor } from './call-supervisor.ts';
import { collectDriverConfigs } from './collect-driver-configs.ts';
import { createEvidenceWriter } from './create-evidence-writer.ts';
import type { Access } from './host.ts';
import { makeFence } from './make-fence.ts';
import { makeDriverExec, makeRepoExec } from './make-fenced-exec.ts';
import type {
  Drive,
  Emit,
  EvidenceFiles,
  OpenedDriver,
  TargetDefinition,
  Wringer,
} from './types.ts';
import { WringerError } from './wringer-error.ts';

export interface DriveRequest {
  readonly wringer: Wringer;
  readonly root: string;
  readonly stateDir: string;
  readonly targetName: string;
  readonly target: TargetDefinition;
  readonly access: Access;
  readonly hint: string;
  readonly run: RunView;
  readonly feature: string | null;
  readonly signal: AbortSignal;

  // When `signal` fires, in ms since the epoch on the `now` clock.
  readonly deadlineAt: number;
  readonly now: () => Date;
  readonly emit: Emit;
  readonly files: EvidenceFiles;
}

export const unassignedFeature = 'unassigned';

// Every client and exec handed to a command body goes through the fence for `access`, so a body
// that writes on a read-only target is refused at the call, whatever the command declared.
export function openDrive(request: DriveRequest): Drive {
  const run = buildRunHandle(request.stateDir, request.run.runID);

  const evidence = createEvidenceWriter({
    root: request.root,
    directory: join(run.paths.features, request.feature ?? unassignedFeature),
    now: request.now,
    files: request.files,
  });

  const execOptions = {
    host: request.target.host,
    access: request.access,
    hint: request.hint,
    signal: request.signal,
  };

  const fence = makeFence({ access: request.access, hint: request.hint });

  const entries = collectDriverConfigs(request.wringer, request.target, {
    target: request.targetName,
    endpoints: request.run.endpoints,
    run,
  });

  const drivers = new Map<string, OpenedDriver>(
    entries.map((entry) => [
      entry.name,
      entry.configured.open({
        target: request.targetName,
        access: request.access,
        endpoints: request.run.endpoints,
        run,
        exec: makeDriverExec(execOptions),
        evidence: evidence.writer,
        signal: request.signal,
        timeLeftMs: () => Math.max(0, request.deadlineAt - request.now().getTime()),
        fence,
        service: (service) => ({
          call: (method, args) =>
            callSupervisor({
              socket: getSocket(request.run),
              request: { service: buildServiceKey(entry.name, service), method, args },
              signal: request.signal,
            }),
        }),
      }),
    ]),
  );

  const clients = Object.fromEntries(
    request.wringer.drivers.map((driver) => [
      driver.name,
      drivers.get(driver.name)?.client ?? buildMissingClient(driver.name, request.targetName),
    ]),
  );

  return {
    drivers,
    evidence: evidence.collected,
    ctx: {
      target: request.targetName,
      access: request.access,
      feature: request.feature,
      endpoints: request.run.endpoints,
      drivers: clients,
      exec: makeRepoExec(execOptions),
      evidence: evidence.writer,
      signal: request.signal,
      emit: request.emit,
    },
  };
}

function getSocket(run: RunView): string {
  if (run.supervisor === null) {
    throw new WringerError('not-running', {
      message: 'The run has no supervisor.',
      hint: 'Run `up --restart`, or `attach` again, to start a new run.',
    });
  }

  return run.supervisor.socket;
}

// A target that gives a driver no config still gets an entry for it, so repo code typed against
// every driver reaches a clear refusal at the first call instead of reading undefined.
function buildMissingClient(driver: string, target: string): unknown {
  return new Proxy(
    {},
    {
      get: () => {
        throw new WringerError('usage', {
          message: `Target ${target} gives the ${driver} driver no config.`,
          hint: `Add a ${driver} entry to the drivers of target ${target}.`,
        });
      },
    },
  );
}
