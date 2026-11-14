import type { AnyDrivers, CommandSpec, DriveContext, RegisteredCommand } from '../types.ts';
import { prepareArgs } from './prepare-args.ts';
import { toTypedDriveContext } from './to-typed-drive-context.ts';

export function buildRepoCommand<Args, Data, Ds extends AnyDrivers>(
  spec: CommandSpec<Args, Data, Ds>,
  targets: readonly string[] | undefined,
  driverNames: readonly string[],
): RegisteredCommand {
  return {
    kind: 'repo',
    info: spec,
    targets,
    prepare: (raw) =>
      prepareArgs(spec.args, raw, (args) => ({
        effect: spec.decideEffect?.(args) ?? spec.effect ?? 'write',
        run: (ctx: DriveContext) => spec.run(args, toTypedDriveContext<Ds>(ctx, driverNames)),
      })),
  };
}
