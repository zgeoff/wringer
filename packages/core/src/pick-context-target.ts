export interface ContextTargetInput {
  readonly targetNames: readonly string[];
  readonly sessionTarget: string | undefined;
  readonly savedTarget: string | undefined;
  readonly commandKey: string;
}

// The target a command runs against: the one the session names, else the saved one, else the first.
// A saved target the registry no longer has stays an error for every command but `use`, which skips
// it, so `use --target` can always choose again.
export function pickContextTarget(input: ContextTargetInput): string {
  const [firstTarget = ''] = input.targetNames;

  const savedTarget =
    input.commandKey === 'use' &&
    input.savedTarget !== undefined &&
    !input.targetNames.includes(input.savedTarget)
      ? undefined
      : input.savedTarget;

  return input.sessionTarget ?? savedTarget ?? firstTarget;
}
