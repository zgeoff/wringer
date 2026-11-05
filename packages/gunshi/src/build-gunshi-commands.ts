import { WringerError } from '@wringer/core';
import type { CommandInfo, Wringer } from '@wringer/core';
import type { Command, CommandContext } from 'gunshi';
import { z } from 'zod';
import { buildGunshiArgs } from './build-gunshi-args.ts';
import type { GunshiArgs } from './build-gunshi-args.ts';
import { buildPositionalArgs } from './build-positional-args.ts';
import { buildRawArgs } from './build-raw-args.ts';
import { collectBooleanFlagsWithValue } from './collect-boolean-flags-with-value.ts';
import { collectFlagsWithoutValue } from './collect-flags-without-value.ts';
import { keepFlagText } from './keep-flag-text.ts';

interface GlobalFlags {
  readonly target?: string | undefined;
  readonly feature?: string | undefined;
  readonly timeoutMs?: number | undefined;
}

export interface Invocation {
  readonly path: readonly string[];
  readonly raw: Readonly<Record<string, unknown>>;
  readonly globals: GlobalFlags;
}

export type InvokeResult =
  | { readonly kind: 'invoked'; readonly invocation: Invocation }
  | { readonly kind: 'refused'; readonly error: WringerError };

// gunshi parses the words; the command runs only after gunshi returns, so every failure, from
// gunshi or from the command, reaches the one place that writes the envelope.
export function buildGunshiCommands(
  wringer: Wringer,
  onInvoke: (result: InvokeResult) => void,
): Record<string, Command> {
  const root = buildTree([...wringer.commands.values()].map((command) => command.info));

  return Object.fromEntries(
    [...root.children].map(([name, node]) => [name, toGunshiCommand([name], node, onInvoke)]),
  );
}

interface CommandNode {
  readonly info: CommandInfo | null;
  readonly children: Map<string, CommandNode>;
}

function buildTree(infos: readonly CommandInfo[]): CommandNode {
  const root: CommandNode = { info: null, children: new Map<string, CommandNode>() };

  for (const info of infos) {
    const parent = info.path.slice(0, -1).reduce((node, word) => resolveChild(node, word), root);
    const name = info.path.at(-1) ?? '';
    const children = parent.children.get(name)?.children ?? new Map<string, CommandNode>();

    parent.children.set(name, { info, children });
  }

  return root;
}

// The node for a path word that only groups commands, such as `action`, is made on first use.
function resolveChild(node: CommandNode, name: string): CommandNode {
  const existing = node.children.get(name);

  if (existing !== undefined) {
    return existing;
  }

  const created: CommandNode = { info: null, children: new Map<string, CommandNode>() };

  node.children.set(name, created);

  return created;
}

const globalArgs: GunshiArgs = {
  target: {
    type: 'string',
    parse: keepFlagText,
    description: 'The target to run on, for this command only',
  },
  feature: {
    type: 'string',
    parse: keepFlagText,
    description: 'The feature to record evidence under',
  },
  timeoutMs: { type: 'number', description: 'The deadline of the command, in milliseconds' },
  human: { type: 'boolean', description: 'Print text for a person' },
  json: { type: 'boolean', description: 'Print the JSON envelope' },
};

function toGunshiCommand(
  path: readonly string[],
  node: CommandNode,
  onInvoke: (result: InvokeResult) => void,
): Command {
  const commandArgs: GunshiArgs = {
    ...(node.info === null ? {} : buildGunshiArgs(node.info)),
    ...buildPositionalArgs(node.info),
  };

  const args: GunshiArgs = { ...globalArgs, ...commandArgs };

  const subCommands = Object.fromEntries(
    [...node.children].map(([name, child]) => [
      name,
      toGunshiCommand([...path, name], child, onInvoke),
    ]),
  );

  return {
    name: path.at(-1) ?? '',
    description: buildDescription(node.info),
    args,
    toKebab: true,
    ...(node.children.size === 0 ? {} : { subCommands }),
    run: (ctx: CommandContext) => {
      onInvoke(pickInvokeResult({ path, args, commandArgs, ctx }));
    },
  };
}

// The help marks each command as a read or a write, so a reader of a read-only target sees which
// commands it refuses before running one. A command that decides by its arguments may be either.
function buildDescription(info: CommandInfo | null): string {
  if (info === null) {
    return '';
  }

  const effect = info.decideEffect === undefined ? (info.effect ?? 'write') : 'read or write';

  return `${info.summary} [${effect}]`;
}

interface InvokeRequest {
  readonly path: readonly string[];
  readonly args: GunshiArgs;
  readonly commandArgs: GunshiArgs;
  readonly ctx: Pick<CommandContext, 'tokens' | 'values' | 'explicit' | 'rest'>;
}

// Words that gunshi parsed but the command cannot take are a usage failure, not an exception.
function pickInvokeResult(request: InvokeRequest): InvokeResult {
  const bareFlags = collectFlagsWithoutValue(request.ctx.tokens, request.args);

  if (bareFlags.length > 0) {
    return {
      kind: 'refused',
      error: new WringerError('usage', {
        message: `Give a value after ${bareFlags.join(', ')}.`,
        hint: "Write `''` after a flag to pass an empty value.",
      }),
    };
  }

  const valuedBooleans = collectBooleanFlagsWithValue(request.ctx.tokens, request.args);

  if (valuedBooleans.length > 0) {
    return {
      kind: 'refused',
      error: new WringerError('usage', {
        message: `${valuedBooleans.join(', ')} takes no value.`,
        hint: 'Write the flag alone to turn it on, or `--no-<flag>` to turn it off.',
      }),
    };
  }

  const built = buildRawArgs(request.commandArgs, request.ctx);

  if (!built.ok) {
    return { kind: 'refused', error: built.error };
  }

  const globals = parseGlobalFlags(request.commandArgs, request.ctx);

  if (globals instanceof WringerError) {
    return { kind: 'refused', error: globals };
  }

  return { kind: 'invoked', invocation: { path: request.path, raw: built.raw, globals } };
}

const globalFlagsSchema = z.strictObject({
  target: z.string().min(1).optional(),
  feature: z.string().min(1).optional(),
  timeoutMs: z.number().int().positive().optional(),
});

// A command that declares its own `--target` or `--feature`, such as `use`, keeps it as an
// argument; the global flag applies to every other command.
function parseGlobalFlags(
  commandArgs: GunshiArgs,
  ctx: Pick<CommandContext, 'values' | 'explicit'>,
): GlobalFlags | WringerError {
  const given = Object.fromEntries(
    Object.keys(globalFlagsSchema.shape).flatMap((name) =>
      Object.hasOwn(commandArgs, name) || ctx.explicit[name] !== true
        ? []
        : [[name, ctx.values[name]] as const],
    ),
  );

  const parsed = globalFlagsSchema.safeParse(given);

  if (!parsed.success) {
    return new WringerError('usage', { message: z.prettifyError(parsed.error) });
  }

  return parsed.data;
}
