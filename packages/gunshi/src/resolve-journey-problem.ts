import { prepareArgs } from '@wringer/core';
import type { RegisteredCommand, Wringer } from '@wringer/core';
import invariant from 'tiny-invariant';
import { match } from 'ts-pattern';
import type { Invocation } from './build-gunshi-commands.ts';
import { resolveInvocation } from './resolve-invocation.ts';

// Why one journey command would fail before it ran, or null when it would run: the words go through
// the CLI's own parser, the arguments through the command's schema, and a feature or a target it
// names must be one the registry declares.
export async function resolveJourneyProblem(
  wringer: Wringer,
  argv: readonly string[],
): Promise<string | null> {
  const parsed = await resolveInvocation(wringer, argv);

  return match(parsed)
    .with({ kind: 'printed' }, () => null)
    .with({ kind: 'failed' }, (failed) => failed.error.message)
    .with({ kind: 'invoked' }, (invoked) => findInvocationProblem(wringer, invoked.invocation))
    .exhaustive();
}

function findInvocationProblem(wringer: Wringer, invocation: Invocation): string | null {
  const command = wringer.commands.get(invocation.path.join(' '));

  invariant(command, 'gunshi invoked a command that the registry lacks.');

  const prepared = prepareArgs(command.info.args, invocation.raw, () => null);

  if (!prepared.ok) {
    return prepared.message;
  }

  return findNameProblem(wringer, command, invocation);
}

// A built-in command, such as `use` or `done`, takes the feature and the target as its own
// arguments; a repo command's argument of that name means something of the repo's.
function findNameProblem(
  wringer: Wringer,
  command: RegisteredCommand,
  invocation: Invocation,
): string | null {
  const own = command.kind === 'builtin' ? invocation.raw : {};
  const feature = invocation.globals.feature ?? findText(own, 'feature');
  const target = invocation.globals.target ?? findText(own, 'target');

  if (feature !== undefined && !wringer.features.some((entry) => entry.name === feature)) {
    return `The feature map has no feature named ${feature}.`;
  }

  if (target !== undefined && !wringer.targets.has(target)) {
    return `The repo has no target named ${target}.`;
  }

  return null;
}

function findText(raw: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = raw[key];

  return typeof value === 'string' ? value : undefined;
}
