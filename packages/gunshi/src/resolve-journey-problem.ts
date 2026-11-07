import type { Wringer } from '@wringer/core';
import invariant from 'tiny-invariant';
import { match } from 'ts-pattern';
import type { Invocation } from './build-gunshi-commands.ts';
import { resolveInvocation } from './resolve-invocation.ts';

// Why one journey command would fail before it ran, or null when it would run: the words go through
// the CLI's own parser, then the arguments through the command's schema, as `dispatch` parses them.
export async function resolveJourneyProblem(
  wringer: Wringer,
  argv: readonly string[],
): Promise<string | null> {
  const parsed = await resolveInvocation(wringer, argv);

  return match(parsed)
    .with({ kind: 'printed' }, () => null)
    .with({ kind: 'failed' }, (failed) => failed.error.message)
    .with({ kind: 'invoked' }, (invoked) => findArgsProblem(wringer, invoked.invocation))
    .exhaustive();
}

function findArgsProblem(wringer: Wringer, invocation: Invocation): string | null {
  const command = wringer.commands.get(invocation.path.join(' '));

  invariant(command, 'gunshi invoked a command that the registry lacks.');

  const parsed = command.info.args.safeParse(invocation.raw);

  if (parsed.success) {
    return null;
  }

  const problems = parsed.error.issues.map((issue) =>
    issue.path.length === 0 ? issue.message : `${issue.path.join('.')}: ${issue.message}`,
  );

  return `The arguments are not valid: ${problems.join('; ')}`;
}
