export interface CommandStopFacts {
  readonly nowMs: number;

  // When the recorder began to stop.
  readonly stopMs: number;

  // When the command last printed a line, or null before its first.
  readonly lastLineMs: number | null;
}

// The command's output has to go this long without a line before the recorder kills it.
const commandQuietMs = 200;

// The longest a stop waits for a command that never goes quiet.
const commandStopLimitMs = 2000;

// How long the recorder still reads a command source once it began to stop, or 0 to kill it now.
export function pickCommandStopDelay(facts: CommandStopFacts): number {
  const quietAtMs = Math.max(facts.stopMs, facts.lastLineMs ?? facts.stopMs) + commandQuietMs;
  const killAtMs = Math.min(quietAtMs, facts.stopMs + commandStopLimitMs);

  return Math.max(0, killAtMs - facts.nowMs);
}
