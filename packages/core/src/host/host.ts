import type { ProcessResult } from './run-process.ts';

export type Access = 'read-write' | 'read-only';

export interface HostRequest {
  readonly argv: readonly string[];
  readonly access: Access;
  readonly stdin?: string | undefined;
  readonly signal?: AbortSignal | undefined;
}

export interface FollowRequest {
  readonly argv: readonly string[];
  readonly access: Access;
  readonly signal: AbortSignal;
  readonly onLine: (line: string) => void;
}

export interface Host {
  readonly kind: 'local' | 'ssh';
  readonly run: (request: HostRequest) => Promise<ProcessResult>;

  // Runs a long-lived command, such as `tail -F`, and hands each line of its stdout to `onLine`
  // until the command exits or the signal fires. Resolves with the command's exit code.
  readonly follow: (request: FollowRequest) => Promise<number>;
}
