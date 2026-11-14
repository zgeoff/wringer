import type { TargetDefinition, Wringer } from '../types.ts';
import { WringerError } from '../wringer-error.ts';

export function getTarget(wringer: Wringer, name: string): TargetDefinition {
  const target = wringer.targets.get(name);

  if (target === undefined) {
    throw new WringerError('usage', {
      message: `The repo has no target named ${name}.`,
      hint: `Pick one of: ${[...wringer.targets.keys()].join(', ')}.`,
    });
  }

  return target;
}
