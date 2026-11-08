import { WringerError } from '@wringer/core';
import type { Wringer } from '@wringer/core';
import { cli, parseArgs } from 'gunshi';
import { buildGunshiCommands } from './build-gunshi-commands.ts';
import type { InvokeResult } from './build-gunshi-commands.ts';
import { findSignedValueFlag } from './find-signed-value-flag.ts';
import type { SignedValueFlag } from './find-signed-value-flag.ts';
import type { ParsedInvocation } from './pick-cli-outcome.ts';
import { pickCommandName } from './pick-command-name.ts';

// gunshi only records the invocation; the command runs after `cli` returns, so a gunshi parse error
// and a command error never mix. gunshi resolves the command path before it checks the flags, so a
// flag error still names the command.
export async function resolveInvocation(
  wringer: Wringer,
  argv: readonly string[],
): Promise<ParsedInvocation> {
  let invoked: InvokeResult | null = null;
  let commandPath: readonly string[] = [];

  const subCommands = buildGunshiCommands(wringer, (result) => {
    invoked = result;
  });

  try {
    const printed = await cli(
      [...argv],
      {
        name: wringer.name,
        run: () => {
          throw new WringerError('usage', {
            message: 'Name a command.',
            hint: `Run \`${wringer.name} --help\` to list them.`,
          });
        },
      },
      {
        name: wringer.name,
        subCommands,
        strict: true,
        usageSilent: true,
        renderHeader: null,
        renderValidationErrors: null,
        onBeforeCommand: (ctx) => {
          commandPath = ctx.commandPath;
        },
      },
    );

    return pickParsedInvocation(invoked, printed, pickCommandName(commandPath, argv));
  } catch (error) {
    return {
      kind: 'failed',
      command: pickCommandName(commandPath, argv),
      error: toUsageError(error, findSignedValueFlag(parseArgs([...argv]), argv)),
    };
  }
}

// gunshi ran no command when it printed help or a version.
function pickParsedInvocation(
  invoked: InvokeResult | null,
  printed: string | undefined,
  command: string,
): ParsedInvocation {
  if (invoked === null) {
    return { kind: 'printed', text: `${printed ?? ''}\n` };
  }

  if (invoked.kind === 'refused') {
    return { kind: 'failed', command, error: invoked.error };
  }

  return { kind: 'invoked', invocation: invoked.invocation };
}

// gunshi throws an AggregateError for a parse failure, with one error per problem.
function toUsageError(error: unknown, signed: SignedValueFlag | undefined): WringerError {
  if (error instanceof WringerError) {
    return error;
  }

  const problems = error instanceof AggregateError ? error.errors.map(String) : [String(error)];

  const hint =
    signed === undefined
      ? 'Add `--help` to the command to see its arguments.'
      : `Join a negative value to its flag with \`=\`: \`${signed.flag}=${signed.value}\`.`;

  return new WringerError('usage', {
    message: problems.map((problem) => problem.replace(/^\w*Error: /u, '')).join(' '),
    hint,
  });
}
