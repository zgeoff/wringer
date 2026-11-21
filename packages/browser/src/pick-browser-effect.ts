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

export interface ActionTarget {
  // Null when a key press goes to whatever element has the focus.
  readonly element: SnapshotElement | null;

  // False when the active tab has left the origins of the endpoints the driver may visit.
  readonly onAllowedOrigin: boolean;
}

// A grant covers one element of the app's own pages. A key press with no element could land in any
// control, and a tab that left the app's origins shows controls no grant was written for.
export function pickActionEffect(target: ActionTarget, grants: readonly SnapshotElement[]): Effect {
  if (target.element === null || !target.onAllowedOrigin) {
    return 'write';
  }

  return pickBrowserEffect(target.element, grants);
}
