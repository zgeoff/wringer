import { exitCodeFor } from '@wringer/core';
import type { WringerError } from '@wringer/core';
import type { Invocation } from '../gunshi-commands/build-gunshi-commands.ts';
import { buildFailureEnvelope } from '../output/build-failure-envelope.ts';
import type { OutputMode } from '../output/pick-output-mode.ts';
import { renderEnvelope } from '../output/render-envelope.ts';

export type ParsedInvocation =
  | { readonly kind: 'invoked'; readonly invocation: Invocation }
  | { readonly kind: 'printed'; readonly text: string }
  | { readonly kind: 'failed'; readonly command: string; readonly error: WringerError };

export type CLIOutcome =
  | { readonly kind: 'write'; readonly text: string; readonly exitCode: number }
  | { readonly kind: 'dispatch'; readonly invocation: Invocation };

// Help and a parse failure end the invocation with their text; only an invoked command dispatches.
export function pickCLIOutcome(parsed: ParsedInvocation, mode: OutputMode): CLIOutcome {
  if (parsed.kind === 'printed') {
    return { kind: 'write', text: parsed.text, exitCode: 0 };
  }

  if (parsed.kind === 'failed') {
    return {
      kind: 'write',
      text: renderEnvelope(buildFailureEnvelope(parsed.command, parsed.error), mode),
      exitCode: exitCodeFor[parsed.error.code],
    };
  }

  return { kind: 'dispatch', invocation: parsed.invocation };
}
