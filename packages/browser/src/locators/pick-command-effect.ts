import type { Effect } from '@wringer/core';
import type { SnapshotElement } from '../find-snapshot-element.ts';
import { pickBrowserEffect } from '../pick-browser-effect.ts';
import type { LocatorArgs } from './find-locator-problem.ts';

// The command cannot see a ref's role before it runs, so only an element named by role and name,
// or by label or text and role, can match a grant here; the client call checks a ref once it knows
// the element, and every element once it knows the tab.
export function pickCommandEffect(args: LocatorArgs, grants: readonly SnapshotElement[]): Effect {
  if (args.role === undefined) {
    return 'write';
  }

  const name = args.text ?? args.label ?? args.name ?? '';

  return pickBrowserEffect({ role: args.role, name }, grants);
}
