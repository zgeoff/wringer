export type OutputMode = 'json' | 'human';

export interface OutputModeInput {
  readonly argv: readonly string[];
  readonly isTTY: boolean;
  readonly isAgent: boolean;
}

// An agent or a pipe reads JSON; a person at a terminal reads text. `--json` and `--human` override
// that guess, and the last of them wins.
export function pickOutputMode(input: OutputModeInput): OutputMode {
  const end = input.argv.indexOf('--');
  const flags = end === -1 ? input.argv : input.argv.slice(0, end);
  const chosen = flags.findLast((flag) => flag === '--json' || flag === '--human');

  if (chosen === '--json') {
    return 'json';
  }

  if (chosen === '--human' || (input.isTTY && !input.isAgent)) {
    return 'human';
  }

  return 'json';
}
