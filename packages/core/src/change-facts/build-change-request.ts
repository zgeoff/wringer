import type { Wringer } from '../types.ts';
import { collectFeatureScopes } from './collect-feature-scopes.ts';
import type { ChangeFactsRequest } from './read-change-facts.ts';

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

// The change facts of the branch: the changed paths and a fingerprint of the whole diff and of each
// feature's scope.
export function buildChangeFactsRequest(
  wringer: Pick<Wringer, 'stateDir' | 'ignore' | 'features' | 'shared'>,
  cwd: string,
  base: string,
): ChangeFactsRequest {
  return {
    ...buildChangeRequest(wringer, cwd, base),
    scopes: collectFeatureScopes(wringer),
    deployed: null,
  };
}
