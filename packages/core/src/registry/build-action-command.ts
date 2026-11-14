import type { ActionDefinition, AnyDrivers, RegisteredCommand } from '../types.ts';
import { buildRepoCommand } from './build-repo-command.ts';

export function buildActionCommand<Input, Data, Ds extends AnyDrivers>(
  action: ActionDefinition<Input, Data, Ds>,
  driverNames: readonly string[],
): RegisteredCommand {
  return buildRepoCommand<Input, Data, Ds>(
    {
      path: ['action', action.name],
      summary: action.summary,
      args: action.input,
      data: action.data,
      effect: action.effect,
      timeoutMs: action.timeoutMs,
      run: action.run,
    },
    action.targets,
    driverNames,
  );
}
