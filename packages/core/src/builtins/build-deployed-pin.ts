import { collectFeatureScopes } from '../change-facts/collect-feature-scopes.ts';
import { isGlobMatch } from '../change-facts/is-glob-match.ts';
import type { Wringer } from '../types.ts';
import type { Pin } from '../verdict/report-schema.ts';
import { WringerError } from '../wringer-error.ts';

export interface DeployedPinRequest {
  readonly feature: string;

  // Null when the target declares no `revision`.
  readonly deployed: string | null;

  // The paths whose content differs between the deployed commit and the worktree.
  readonly deployedPaths: readonly string[];
}

// A verdict pins to the deployed commit when that commit holds the same content as the worktree in
// the feature's scope.
export function buildDeployedPin(
  wringer: Pick<Wringer, 'features' | 'shared'>,
  request: DeployedPinRequest,
): Pin {
  if (request.deployed === null) {
    return { kind: 'unpinned' };
  }

  const scope = collectFeatureScopes(wringer).find((each) => each.name === request.feature);
  const differing = request.deployedPaths.filter((path) => isGlobMatch(path, scope?.globs ?? []));

  if (differing.length > 0) {
    throw new WringerError('check-failed', {
      message: `The deployed commit ${request.deployed} differs from the worktree in the scope of ${request.feature}: ${formatPaths(differing)}.`,
      hint: 'Deploy the worktree, or check out the deployed commit, then run `doctor` and drive the feature again.',
    });
  }

  return { kind: 'deployed', revision: request.deployed };
}

// How many differing paths a refusal names.
const listedPathLimit = 10;

function formatPaths(paths: readonly string[]): string {
  const listed = paths.slice(0, listedPathLimit).join(', ');

  return paths.length > listedPathLimit
    ? `${listed}, and ${paths.length - listedPathLimit} more`
    : listed;
}
