import type { Access } from './host.ts';
import type { Effect } from './types.ts';
import { WringerError } from './wringer-error.ts';

export interface AccessInput {
  readonly path: readonly string[];
  readonly allowedTargets: readonly string[] | undefined;
  readonly targetName: string;
  readonly access: Access;
  readonly effect: Effect;

  // False for a command that never touches the target: its effect then says nothing about it.
  readonly touchesTarget: boolean;
  readonly hint: string;
}

// A repo command may name the only targets it runs on, and a read-only target takes only reads of
// a command that touches it.
export function pickAccessRefusal(input: AccessInput): WringerError | null {
  const commandText = `\`${input.path.join(' ')}\``;

  if (input.allowedTargets !== undefined && !input.allowedTargets.includes(input.targetName)) {
    return new WringerError('target-not-allowed', {
      message: `${commandText} runs only on ${input.allowedTargets.join(', ')}.`,
    });
  }

  if (input.touchesTarget && input.access === 'read-only' && input.effect !== 'read') {
    return new WringerError('read-only', {
      message: `${commandText} is a write, and target ${input.targetName} is read-only.`,
      hint: input.hint,
    });
  }

  return null;
}
