export interface LineSplit {
  readonly lines: readonly string[];
  readonly carry: string;
}

// The text after the last newline waits for the rest of its line. It keeps one character past
// `capLength`, enough for the record to show the cut, so a file that never ends its line stays
// small.
export function collectLines(carry: string, text: string, capLength: number): LineSplit {
  const parts = `${carry}${text}`.split('\n');

  return { lines: parts.slice(0, -1), carry: (parts.at(-1) ?? '').slice(0, capLength + 1) };
}
