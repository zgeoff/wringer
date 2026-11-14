import { buildDoctorCommand } from '../builtins/build-doctor-command.ts';
import { buildExecCommand } from '../builtins/build-exec-command.ts';
import { buildLifecycleCommands } from '../builtins/build-lifecycle-commands.ts';
import { buildStateCommands } from '../builtins/build-state-commands.ts';
import { buildVerdictCommands } from '../builtins/build-verdict-commands.ts';
import type {
  ActionDefinition,
  AnyDriver,
  AnyDrivers,
  CheckDefinition,
  CommandSpec,
  FeatureDefinition,
  GatePolicy,
  HookHandlers,
  RegisteredCommand,
  RunnableRepoCheck,
  TargetDefinition,
  Wringer,
} from '../types.ts';
import { maxNameLength } from '../verdict/report-schema.ts';
import { WringerError } from '../wringer-error.ts';
import { buildActionCommand } from './build-action-command.ts';
import { buildRepoCheck } from './build-repo-check.ts';
import { buildRepoCommand } from './build-repo-command.ts';

export interface WringerOptions {
  readonly name: string;
  readonly stateDir?: string | undefined;
}

export interface WringerBuilder<Ds extends AnyDrivers> {
  readonly use: <const Added extends readonly AnyDriver[]>(
    ...drivers: Added
  ) => WringerBuilder<readonly [...Ds, ...Added]>;
  readonly target: (name: string, target: TargetDefinition<Ds>) => WringerBuilder<Ds>;
  readonly command: <Args, Data>(spec: CommandSpec<Args, Data, Ds>) => WringerBuilder<Ds>;
  readonly action: <Input, Data>(action: ActionDefinition<Input, Data, Ds>) => WringerBuilder<Ds>;
  readonly check: <Input, Data>(check: CheckDefinition<Input, Data, Ds>) => WringerBuilder<Ds>;
  readonly secret: (...envNames: readonly string[]) => WringerBuilder<Ds>;
  readonly feature: (...features: readonly FeatureDefinition[]) => WringerBuilder<Ds>;
  readonly shared: (...globs: readonly string[]) => WringerBuilder<Ds>;
  readonly ignore: (...globs: readonly string[]) => WringerBuilder<Ds>;
  readonly gate: (policy: GatePolicy) => WringerBuilder<Ds>;
  readonly hook: <Name extends keyof HookHandlers>(
    name: Name,
    handler: HookHandlers[Name],
  ) => WringerBuilder<Ds>;
  readonly build: () => Wringer;
}

// Each call returns a new builder. `build` adds the built-in commands, refuses a duplicate command
// path or target name, then freezes the registry.
export function createWringer(options: WringerOptions): WringerBuilder<readonly []> {
  return makeBuilder({
    options,
    drivers: [],
    targets: [],
    commands: [],
    checks: [],
    features: [],
    shared: [],
    ignore: [],
    gatePolicy: { unpinned: 'allow' },
    hooks: {},
    secrets: [],
  });
}

interface Parts {
  readonly options: WringerOptions;
  readonly drivers: readonly AnyDriver[];
  readonly targets: readonly (readonly [string, TargetDefinition])[];
  readonly commands: readonly ((driverNames: readonly string[]) => RegisteredCommand)[];
  readonly checks: readonly ((driverNames: readonly string[]) => RunnableRepoCheck)[];
  readonly features: readonly FeatureDefinition[];
  readonly shared: readonly string[];
  readonly ignore: readonly string[];
  readonly gatePolicy: GatePolicy;
  readonly hooks: Partial<HookHandlers>;
  readonly secrets: readonly string[];
}

function makeBuilder<Ds extends AnyDrivers>(parts: Parts): WringerBuilder<Ds> {
  return {
    // oxlint-disable-next-line zgeoff/function-verb -- the public builder API names this step `use`
    use: (...drivers) => makeBuilder({ ...parts, drivers: [...parts.drivers, ...drivers] }),
    target: (name, target) =>
      makeBuilder({ ...parts, targets: [...parts.targets, [name, target]] }),
    command: (spec) =>
      makeBuilder({
        ...parts,
        commands: [...parts.commands, (names) => buildRepoCommand(spec, undefined, names)],
      }),
    action: (action) =>
      makeBuilder({
        ...parts,
        commands: [...parts.commands, (names) => buildActionCommand(action, names)],
      }),
    check: (check) =>
      makeBuilder({ ...parts, checks: [...parts.checks, (names) => buildRepoCheck(check, names)] }),
    feature: (...features) => makeBuilder({ ...parts, features: [...parts.features, ...features] }),
    shared: (...globs) => makeBuilder({ ...parts, shared: [...parts.shared, ...globs] }),
    secret: (...envNames) => makeBuilder({ ...parts, secrets: [...parts.secrets, ...envNames] }),
    ignore: (...globs) => makeBuilder({ ...parts, ignore: [...parts.ignore, ...globs] }),
    gate: (policy) => makeBuilder({ ...parts, gatePolicy: policy }),
    hook: (name, handler) => makeBuilder({ ...parts, hooks: { ...parts.hooks, [name]: handler } }),
    build: () => buildWringer(parts),
  };
}

export const defaultStateDir = '.wringer';

function buildWringer(parts: Parts): Wringer {
  if (parts.targets.length === 0) {
    throw new WringerError('usage', { message: 'A wringer CLI needs at least one target.' });
  }

  if (parts.options.name.length === 0 || parts.options.name.length > maxNameLength) {
    throw new WringerError('usage', {
      message: `The registry name \`${parts.options.name}\` must hold 1 to ${maxNameLength} characters.`,
      hint: 'Give the registry a name the data comment can hold.',
    });
  }

  const longName = [
    ...parts.features.map((feature) => ['feature', feature.name] as const),
    ...parts.targets.map(([name]) => ['target', name] as const),
  ].find(([, name]) => name.length > maxNameLength);

  if (longName !== undefined) {
    throw new WringerError('usage', {
      message: `The ${longName[0]} name \`${longName[1]}\` is longer than ${maxNameLength} characters.`,
      hint: 'Shorten the name.',
    });
  }

  const driverNames = parts.drivers.map((driver) => driver.name);

  // A run keys each driver's services by its name, so a second driver of one name would replace
  // the first one's services and leave them running past the run.
  const repeated = driverNames.find((name, index) => driverNames.indexOf(name) !== index);

  if (repeated !== undefined) {
    throw new WringerError('usage', {
      message: `Two drivers are named \`${repeated}\`.`,
      hint: 'Give each driver its own name.',
    });
  }

  const driverCommands = parts.drivers.flatMap((driver) =>
    driver.commands.map((info): RegisteredCommand => ({
      kind: 'driver',
      info,
      driver: driver.name,
    })),
  );

  // A driver command reaches its client through the run's services, so it cannot run without one.
  const runless = driverCommands.find((command) => command.info.needsRun === false);

  if (runless !== undefined) {
    throw new WringerError('usage', {
      message: `The driver command \`${runless.info.path.join(' ')}\` needs a run, because its client calls the run's services.`,
      hint: 'Leave `needsRun` unset on a driver command.',
    });
  }

  const checks = parts.checks.map((buildEntry) => buildEntry(driverNames));

  // The doctor names its own check of a target's `revision` this way, so a repo check of that name
  // would share a result name with it.
  const revisionTarget = parts.targets.find(
    ([, target]) => target.mode === 'attach' && target.revision !== undefined,
  );

  if (revisionTarget !== undefined && checks.some((check) => check.name === 'revision')) {
    throw new WringerError('usage', {
      message: `A repo check is named \`revision\`, which the doctor uses for the revision of target \`${revisionTarget[0]}\`.`,
      hint: 'Rename the repo check.',
    });
  }

  const registered = [
    ...buildLifecycleCommands(),
    ...buildStateCommands(),
    ...buildVerdictCommands(),
    buildDoctorCommand(),
    buildExecCommand(),
    ...driverCommands,
    ...parts.commands.map((buildEntry) => buildEntry(driverNames)),
  ];

  return Object.freeze({
    name: parts.options.name,
    stateDir: parts.options.stateDir ?? defaultStateDir,
    drivers: Object.freeze([...parts.drivers]),
    targets: buildUniqueMap(parts.targets, 'target'),
    commands: buildUniqueMap(
      registered.map((command) => [command.info.path.join(' '), command] as const),
      'command',
    ),
    checks: Object.freeze(checks),
    features: Object.freeze([...parts.features]),
    shared: Object.freeze([...parts.shared]),
    ignore: Object.freeze([...parts.ignore]),
    gate: Object.freeze({ ...parts.gatePolicy }),
    hooks: Object.freeze({ ...parts.hooks }),
    secrets: Object.freeze([...parts.secrets]),
  });
}

function buildUniqueMap<Value>(
  entries: readonly (readonly [string, Value])[],
  kind: string,
): ReadonlyMap<string, Value> {
  const map = new Map<string, Value>();

  for (const [key, value] of entries) {
    if (map.has(key)) {
      throw new WringerError('usage', { message: `Two ${kind}s share the name \`${key}\`.` });
    }

    map.set(key, value);
  }

  return map;
}
