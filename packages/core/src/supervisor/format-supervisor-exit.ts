import type { SupervisorExit } from '../types.ts';
import { describeSupervisorExit } from './describe-supervisor-exit.ts';

const tailLines = 10;
const urlCredentialsPattern = /(?<scheme>[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]*:[^\s/]*@/giu;

// The reason a supervisor's early exit gives, with the end of its log, for the one message the
// caller reads. A line that holds URL credentials has them redacted, up to the last `@` of the
// authority, as a password may hold one.
export function formatSupervisorExit(exit: SupervisorExit, logText: string): string {
  const reason = `the supervisor exited with ${describeSupervisorExit(exit)} before the run was ready`;

  const lines = logText
    .split('\n')
    .filter((line) => line.trim() !== '')
    .slice(-tailLines)
    .map((line) => cutLine(line.replaceAll(urlCredentialsPattern, '$<scheme>[redacted]@')));

  if (lines.length === 0) {
    return `${reason}; its log is empty`;
  }

  return `${reason}; the end of its log:\n${capTail(lines).join('\n')}`;
}

const maxLineChars = 300;

function cutLine(line: string): string {
  return line.length > maxLineChars ? `${line.slice(0, maxLineChars)}...` : line;
}

const maxTailChars = 2000;

// Drops the oldest lines first, so the newest stay.
function capTail(lines: readonly string[]): string[] {
  const kept: string[] = [];
  let total = 0;

  for (const line of lines.toReversed()) {
    total += line.length + (kept.length === 0 ? 0 : 1);

    if (total > maxTailChars) {
      break;
    }

    kept.unshift(line);
  }

  return kept;
}
