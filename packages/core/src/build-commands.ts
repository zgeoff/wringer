import { prepareArgs } from './prepare-args.ts';
import type {
  ActionDefinition,
  AnyDrivers,
  BuiltinCommandSpec,
  CheckDefinition,
  CommandSpec,
  DriveContext,
  DriverClients,
  RegisteredCommand,
  RunnableRepoCheck,
} from './types.ts';
import { WringerError } from './wringer-error.ts';

// Each function here closes over one command's own types and hands the registry an erased entry,
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

export function buildRepoCheck<Input, Data, Ds extends AnyDrivers>(
  check: CheckDefinition<Input, Data, Ds>,
  driverNames: readonly string[],
): RunnableRepoCheck {
  return {
    name: check.name,
    timeoutMs: check.timeoutMs,
    run: async (ctx) => {
      const typed = toTypedDriveContext<Ds>(ctx, driverNames);

      const data = await check.run(check.input.parse({}), typed);

      check.data.parse(data);
    },
  };
}

// Dispatch puts a client for every registered driver in `drivers`, and a target that gives a driver
// no config gets a client that refuses each call, so every name the repo typed is present.
function toTypedDriveContext<Ds extends AnyDrivers>(
  ctx: DriveContext,
  driverNames: readonly string[],
): DriveContext<Ds> {
  const clients = ctx.drivers;

  if (!hasDriverClients<Ds>(clients, driverNames)) {
    throw new WringerError('internal', { message: 'The drive context lacks a driver client.' });
  }

  return { ...ctx, drivers: clients };
}

function hasDriverClients<Ds extends AnyDrivers>(
  clients: DriveContext['drivers'],
  driverNames: readonly string[],
): clients is DriverClients<Ds> {
  return driverNames.every((name) => Object.hasOwn(clients, name));
}
