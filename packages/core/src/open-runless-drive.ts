import { join } from 'node:path';
import { createEvidenceWriter } from './create-evidence-writer.ts';
import type { Access } from './host.ts';
import { makeRepoExec } from './make-fenced-exec.ts';
import type { Drive, Emit, EvidenceFiles, TargetDefinition, Wringer } from './types.ts';
import { WringerError } from './wringer-error.ts';

export interface RunlessDriveRequest {
  readonly wringer: Wringer;
  readonly root: string;
  readonly stateDir: string;
  readonly targetName: string;
  readonly target: TargetDefinition;
  readonly access: Access;
  readonly hint: string;
  readonly feature: string | null;
  readonly signal: AbortSignal;
  readonly now: () => Date;
  readonly emit: Emit;
  readonly files: EvidenceFiles;
}

// A repo command that declares it needs no run still gets the fenced exec and an evidence folder.
// Its driver clients refuse at the first call, because no run holds their services.
export function openRunlessDrive(request: RunlessDriveRequest): Drive {
  const evidence = createEvidenceWriter({
    root: request.root,
    directory: join(request.stateDir, 'payloads'),
    now: request.now,
    files: request.files,
  });

  const clients = Object.fromEntries(
    request.wringer.drivers.map((driver) => [driver.name, buildRunlessClient(driver.name)]),
  );

  return {
    drivers: new Map(),
    evidence: evidence.collected,
    ctx: {
      target: request.targetName,
      access: request.access,
      feature: request.feature,
      endpoints: {},
      drivers: clients,
      exec: makeRepoExec({
        host: request.target.host,
        access: request.access,
        hint: request.hint,
        signal: request.signal,
      }),
      evidence: evidence.writer,
      signal: request.signal,
      emit: request.emit,
    },
  };
}

function buildRunlessClient(driver: string): unknown {
  return new Proxy(
    {},
    {
      get: () => {
        throw new WringerError('not-running', {
          message: `The ${driver} driver needs a running run, and this command runs without one.`,
          hint: 'Set `needsRun` on the command, or start a run with `up` or `attach`.',
        });
      },
    },
  );
}
