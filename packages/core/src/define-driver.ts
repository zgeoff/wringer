import type { z } from 'zod';
import { collectURLPasswords } from './collect-url-passwords.ts';
import type { Secret } from './create-secret-set.ts';
import { prepareArgs } from './prepare-args.ts';
import type {
  CollectedSecret,
  Driver,
  DriverCheckDefinition,
  DriverCommand,
  DriverCommandContext,
  DriverCommandHelper,
  DriverSession,
  Fence,
  OpenedDriver,
  ServiceDefinition,
  SessionParts,
} from './types.ts';
import { WringerError } from './wringer-error.ts';

export interface DriverDefinition<
  Name extends string,
  Options,
  OptionsInput,
  TargetConfig,
  ConfigInput,
  Client,
> {
  readonly name: Name;
  readonly options: z.ZodType<Options, OptionsInput>;
  readonly targetConfig: z.ZodType<TargetConfig, ConfigInput>;
  readonly services?: Readonly<Record<string, ServiceDefinition<Options, TargetConfig>>>;
  readonly client: (session: DriverSession<Options, TargetConfig>, fence: Fence) => Client;
  readonly commands?: (
    command: DriverCommandHelper<Options, TargetConfig, Client>,
  ) => readonly DriverCommand<Options, TargetConfig, Client>[];
  readonly checks?: readonly DriverCheckDefinition<Options, TargetConfig, Client>[];

  // The secret values of a parsed target config, such as an API token.
  readonly secrets?: (config: TargetConfig) => readonly CollectedSecret[];
}

export type DriverFactory<Name extends string, OptionsInput, ConfigInput, Client> = (
  options: OptionsInput,
) => Driver<Name, Client, ConfigInput>;

// A driver package exports the factory this returns. The repo calls it once with its repo-wide
// options, which are parsed there. Each target's config is parsed when a run opens the driver, and
// every type stays inside these closures, so the registry holds drivers of any shape.
export function defineDriver<
  Name extends string,
  Options,
  OptionsInput,
  TargetConfig,
  ConfigInput,
  Client,
>(
  definition: DriverDefinition<Name, Options, OptionsInput, TargetConfig, ConfigInput, Client>,
): DriverFactory<Name, OptionsInput, ConfigInput, Client> {
  const commands =
    definition.commands?.((spec) => ({
      info: spec,
      prepare: (raw) =>
        prepareArgs(spec.args, raw, (args) => ({
          decideEffect: (config: TargetConfig) =>
            spec.decideEffect?.(args, config) ?? spec.effect ?? 'write',
          run: (ctx: DriverCommandContext<Options, TargetConfig, Client>) => spec.run(args, ctx),
        })),
    })) ?? [];

  const byPath = new Map(commands.map((command) => [command.info.path.join(' '), command]));

  return (input) => {
    const options = definition.options.parse(input);

    return {
      kind: 'driver',
      name: definition.name,
      commands: commands.map((command) => command.info),
      serviceNames: Object.keys(definition.services ?? {}),
      configure: (configInput) => {
        const parsed = definition.targetConfig.safeParse(configInput);

        if (!parsed.success) {
          return { ok: false, message: parsed.error.message };
        }

        const config = parsed.data;

        return {
          ok: true,
          prepared: {
            collectSecrets: () => [
              ...buildDeclaredSecrets(definition.secrets?.(config) ?? []),
              ...collectURLPasswords(definition.name, config),
            ],
            open: (parts) => openDriver({ definition, options, config, byPath, parts }),
            startService: (name, parts) => {
              const service = definition.services?.[name];

              if (service === undefined) {
                return Promise.reject(
                  new WringerError('internal', {
                    message: `The ${definition.name} driver has no service ${name}.`,
                  }),
                );
              }

              return service.start({ ...parts, options, config });
            },
          },
        };
      },
    };
  };
}

function buildDeclaredSecrets(secrets: readonly CollectedSecret[]): Secret[] {
  const declared: Secret[] = [];

  for (const secret of secrets) {
    declared.push({ name: secret.name, value: secret.value, origin: 'declared' });
  }

  return declared;
}

interface OpenRequest<Options, TargetConfig, Client> {
  readonly definition: {
    readonly client: (session: DriverSession<Options, TargetConfig>, fence: Fence) => Client;
    readonly checks?: readonly DriverCheckDefinition<Options, TargetConfig, Client>[];
  };
  readonly options: Options;
  readonly config: TargetConfig;
  readonly byPath: ReadonlyMap<string, DriverCommand<Options, TargetConfig, Client>>;
  readonly parts: SessionParts;
}

function openDriver<Options, TargetConfig, Client>(
  request: OpenRequest<Options, TargetConfig, Client>,
): OpenedDriver {
  const session: DriverSession<Options, TargetConfig> = {
    target: request.parts.target,
    access: request.parts.access,
    options: request.options,
    config: request.config,
    endpoints: request.parts.endpoints,
    run: request.parts.run,
    exec: request.parts.exec,
    evidence: request.parts.evidence,
    cursors: request.parts.cursors,
    signal: request.parts.signal,
    timeLeftMs: request.parts.timeLeftMs,
    service: request.parts.service,
    secrets: request.parts.secrets,
  };

  const client = request.definition.client(session, request.parts.fence);

  return {
    client,
    checks: (request.definition.checks ?? []).map((check) => ({
      name: check.name,
      timeoutMs: check.timeoutMs,
      run: (feature, emit) => check.run({ session, client, feature, emit }),
    })),
    prepare: (pathKey, raw) => {
      const command = request.byPath.get(pathKey);

      if (command === undefined) {
        return { ok: false, message: `The driver has no command \`${pathKey}\`.` };
      }

      const prepared = command.prepare(raw);

      return prepared.ok
        ? {
            ok: true,
            prepared: {
              effect: prepared.prepared.decideEffect(request.config),
              run: (feature, emit) => prepared.prepared.run({ session, client, feature, emit }),
            },
          }
        : prepared;
    },
  };
}
