import type { SecretSet } from './create-secret-set.ts';
import { escapeReportText } from './escape-report-text.ts';
import type { JourneyStep } from './report-document.ts';

interface JourneyRowCells {
  readonly number: number;
  readonly step: JourneyStep;
  readonly evidenceCell: string;

  // The Data cell's content; null when the table has no Data column.
  readonly dataCell: string | null;
}

export function renderJourneyRow(row: JourneyRowCells, secrets: SecretSet): string {
  const cells = [
    String(row.number),
    `<code>${formatCommand(row.step.command, secrets)}</code>`,
    formatResult(row.step, secrets),
    row.evidenceCell,
    ...(row.dataCell === null ? [] : [row.dataCell]),
  ];

  return `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`;
}

function formatCommand(command: string, secrets: SecretSet): string {
  return escapeReportText(secrets.scrubText(command).replaceAll(/[`<>]/gu, ''), secrets);
}

function formatResult(step: JourneyStep, secrets: SecretSet): string {
  const outcome = step.ok ? 'ok' : `failed${step.code === null ? '' : `: ${step.code}`}`;

  return escapeReportText(`${outcome}, ${step.durationMs} ms`, secrets);
}
