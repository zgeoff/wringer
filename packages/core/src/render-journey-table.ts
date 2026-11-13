import type { SecretSet } from './create-secret-set.ts';
import { escapeReportText } from './escape-report-text.ts';
import { formatStepData } from './format-step-data.ts';
import { renderEvidenceCell } from './render-evidence-cell.ts';
import type { Journey, JourneyStep } from './report-document.ts';

// The journey's rows as an HTML table, with a Data column when a row shows data. A code block sits
// between blank lines, so a client that reads the cell as Markdown renders it.
export function renderJourneyTable(
  journey: Journey,
  linkHosts: readonly string[],
  secrets: SecretSet,
): string {
  const rows = journey.steps.map((step, index) => ({
    step,
    number: index + 1,
    data:
      journey.evidence === 'upload'
        ? formatStepData(
            step.data,
            step.files.map((file) => file.evidence),
            secrets,
          )
        : null,
  }));

  const hasData = rows.some((row) => row.data !== null);

  const header = ['#', 'Command', 'Result', 'Evidence', ...(hasData ? ['Data'] : [])]
    .map((title) => `<th>${title}</th>`)
    .join('');

  const body = rows.map((row) => {
    const cells = [
      String(row.number),
      `<code>${formatCommand(row.step.command, secrets)}</code>`,
      formatResult(row.step, secrets),
      renderEvidenceCell(row.step.files, linkHosts, secrets),
      ...(hasData ? [formatDataCell(row.data)] : []),
    ];

    return `<tr>${cells.map((cell) => `<td>${cell}</td>`).join('')}</tr>`;
  });

  return ['<table>', `<tr>${header}</tr>`, ...body, '</table>'].join('\n');
}

function formatCommand(command: string, secrets: SecretSet): string {
  return escapeReportText(secrets.scrubText(command).replaceAll(/[`<>]/gu, ''), secrets);
}

function formatResult(step: JourneyStep, secrets: SecretSet): string {
  const outcome = step.ok ? 'ok' : `failed${step.code === null ? '' : `: ${step.code}`}`;

  return escapeReportText(`${outcome}, ${step.durationMs} ms`, secrets);
}

function formatDataCell(data: string | null): string {
  return data === null ? '' : `\n\n\`\`\`json\n${data}\n\`\`\`\n\n`;
}
