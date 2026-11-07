import type { ProcessResult } from './run-process.ts';

export type Access = 'read-write' | 'read-only';

export interface HostRequest {
  readonly argv: readonly string[];
  readonly access: Access;
  readonly stdin?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface Host {
  readonly kind: 'local' | 'ssh';
  readonly run: (request: HostRequest) => Promise<ProcessResult>;
}
