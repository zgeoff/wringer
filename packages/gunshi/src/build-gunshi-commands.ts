import { WringerError } from '@wringer/core';
import type { CommandInfo, Wringer } from '@wringer/core';
import type { Command, CommandContext } from 'gunshi';
import { z } from 'zod';
import { buildGunshiArgs } from './build-gunshi-args.ts';
import type { GunshiArgs } from './build-gunshi-args.ts';
import { buildPositionals } from './build-positionals.ts';
import { buildRawArgs } from './build-raw-args.ts';
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

// gunshi parses the words; the command runs only after gunshi returns, so every failure, from
// gunshi or from the command, reaches the one place that writes the envelope.
export function buildGunshiCommands(
  wringer: Wringer,
  onInvoke: (invocation: Invocation) => void,
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
  onInvoke: (invocation: Invocation) => void,
): Command {
  const commandArgs = node.info === null ? {} : buildGunshiArgs(node.info);
  const positionals = node.info === null ? [] : buildPositionals(node.info);
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
      const bareFlags = collectFlagsWithoutValue(ctx.tokens, args);

      if (bareFlags.length > 0) {
        throw new WringerError('usage', {
          message: `Give a value after ${bareFlags.join(', ')}.`,
          hint: "Write `''` after a flag to pass an empty value.",
        });
      }

      // gunshi's positionals start with the words of the command's path.
      const words = [...ctx.positionals.slice(path.length), ...ctx.rest];

      onInvoke({
        path,
        raw: buildRawArgs(commandArgs, positionals, {
          values: ctx.values,
          explicit: ctx.explicit,
          words,
        }),
        globals: parseGlobalFlags(commandArgs, ctx),
      });
    },
  };
}

// The help marks each command as a read or a write, so a reader of a read-only target sees which
// commands it refuses before running one.
function buildDescription(info: CommandInfo | null): string {
  if (info === null) {
    return '';
  }

  return `${info.summary} [${info.effect ?? 'write'}]`;
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
): GlobalFlags {
  const given = Object.fromEntries(
    Object.keys(globalFlagsSchema.shape).flatMap((name) =>
      Object.hasOwn(commandArgs, name) || ctx.explicit[name] !== true
        ? []
        : [[name, ctx.values[name]] as const],
    ),
  );

  const parsed = globalFlagsSchema.safeParse(given);

  if (!parsed.success) {
    throw new WringerError('usage', { message: z.prettifyError(parsed.error) });
  }

  return parsed.data;
}
