import type {
  ActionDefinition,
  AnyDrivers,
  CheckDefinition,
  CommandSpec,
  TargetDefinition,
} from './types.ts';

export interface BoundHelpers<Ds extends AnyDrivers> {
  readonly drivers: Ds;
  readonly defineAction: <Input, Data>(
    action: ActionDefinition<Input, Data, Ds>,
  ) => ActionDefinition<Input, Data, Ds>;
  readonly defineTarget: <Target extends TargetDefinition<Ds>>(target: Target) => Target;
  readonly defineCommand: <Args, Data>(
    spec: CommandSpec<Args, Data, Ds>,
  ) => CommandSpec<Args, Data, Ds>;
  readonly defineCheck: <Input, Data>(
    check: CheckDefinition<Input, Data, Ds>,
  ) => CheckDefinition<Input, Data, Ds>;
}

// The repo binds its helpers once, in its drivers file, so every action, target, command and check
// it defines elsewhere is typed against its own drivers without naming them again.
export function bindDrivers<const Ds extends AnyDrivers>(drivers: Ds): BoundHelpers<Ds> {
  return {
    drivers,
    defineAction: (action) => action,
    defineTarget: (target) => target,
    defineCommand: (spec) => spec,
    defineCheck: (check) => check,
  };
}
