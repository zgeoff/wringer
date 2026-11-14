import type { Journey } from '../report-document/report-document.ts';

// "6 commands, 4 s".
export function formatJourneySize(journey: Journey): string {
  const count = journey.steps.length;
  const totalMs = journey.steps.reduce((total, step) => total + step.durationMs, 0);
  const time = totalMs < 1000 ? `${totalMs} ms` : `${Math.round(totalMs / 1000)} s`;

  return `${count} ${count === 1 ? 'command' : 'commands'}, ${time}`;
}
