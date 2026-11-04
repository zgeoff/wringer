import type { ArgToken } from 'gunshi';

export type OutputMode = 'json' | 'human';

export interface OutputModeInput {
  readonly tokens: readonly ArgToken[];
  readonly isTTY: boolean;
  readonly isAgent: boolean;
}

// An agent or a pipe reads JSON; a person at a terminal reads text. `--json` and `--human` override
// that guess, and the last of them wins. The tokens come from gunshi's parser, which also reads
// `--json=true`, and stops reading options at `--`.
export function pickOutputMode(input: OutputModeInput): OutputMode {
  const chosen = input.tokens.findLast(
    (token) =>
      token.kind === 'option' &&
      (token.name === 'json' || token.name === 'human') &&
      token.value !== 'false',
  );

  if (chosen?.name === 'json') {
    return 'json';
  }

  if (chosen?.name === 'human' || (input.isTTY && !input.isAgent)) {
    return 'human';
  }

  return 'json';
}
