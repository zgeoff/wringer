import type { BuiltinCommandSpec, RegisteredCommand } from '../types.ts';
import { prepareArgs } from './prepare-args.ts';

// Each command builder closes over one command's own types and hands the registry an erased entry,
// so commands of every argument type share one map without a type assertion.
export function buildBuiltinCommand<Args, Data>(
  spec: BuiltinCommandSpec<Args, Data>,
): RegisteredCommand {
  return {
    kind: 'builtin',
    info: spec,
    prepare: (raw) =>
      prepareArgs(spec.args, raw, (args) => ({
        effect: spec.effect ?? 'write',
        run: (ctx) => spec.run(args, ctx),
      })),
  };
}
