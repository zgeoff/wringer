import { isAbsolute, relative } from 'node:path';

export type DestinationState = 'absent' | 'wringer-skill' | 'other';

export interface SkillCopyPlan {
  readonly source: string;
  readonly destination: string;
  readonly cwd: string;
  readonly state: DestinationState;
}

// Why the installer must not remove the destination, or null when it may. The install removes the
// destination before it copies, so a wrong `--dir` would delete another skill or the repo.
export function findSkillCopyRefusal(plan: SkillCopyPlan): string | null {
  if (isInside(plan.destination, plan.cwd)) {
    return `${plan.destination} holds the current folder.`;
  }

  if (isInside(plan.destination, plan.source) || isInside(plan.source, plan.destination)) {
    return `${plan.destination} overlaps the packaged skill.`;
  }

  if (plan.state === 'other') {
    return `${plan.destination} exists and is not a copy of the wringer skill.`;
  }

  return null;
}

function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);

  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}
