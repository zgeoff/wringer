import type { Wringer } from './types.ts';

export interface ChangeRequest {
  readonly cwd: string;
  readonly base: string;
  readonly exclude: readonly string[];
  readonly ignore: readonly string[];
}

// Every read of the fingerprint or the changed paths leaves out the same paths, so a verdict, a run
// and the gate agree on what the branch changes.
export function buildChangeRequest(
  wringer: Pick<Wringer, 'stateDir' | 'ignore'>,
  cwd: string,
  base: string,
): ChangeRequest {
  return { cwd, base, exclude: [wringer.stateDir], ignore: wringer.ignore };
}
