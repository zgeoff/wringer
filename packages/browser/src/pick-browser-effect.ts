import type { Effect } from '@wringer/core';
import type { SnapshotElement } from './find-snapshot-element.ts';

// A click or a fill is a write unless the target grants that element by its exact role and name.
export function pickBrowserEffect(
  element: SnapshotElement,
  grants: readonly SnapshotElement[],
): Effect {
  const granted = grants.some(
    (grant) => grant.role === element.role && grant.name === element.name,
  );

  return granted ? 'read' : 'write';
}
