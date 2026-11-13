import { collectStepData } from './collect-step-data.ts';
import type { SecretSet } from './create-secret-set.ts';
import { formatDataBlock } from './format-data-block.ts';
import { pickJourneyRows } from './pick-journey-rows.ts';
import { renderEvidenceCell } from './render-evidence-cell.ts';
import { renderGapRow } from './render-gap-row.ts';
import { renderJourneyRow } from './render-journey-row.ts';
import { renderTableHeader } from './render-table-header.ts';
import type { Journey, JourneyStep } from './report-document.ts';
import type { FeaturePlan } from './report-plan.ts';

// The journey's rows as an HTML table, with a Data column when a shown row has data. The plan's
// cuts for the feature leave out data, rows and files.
export function renderJourneyTable(
  journey: Journey,
  linkHosts: readonly string[],
  secrets: SecretSet,
  cuts: FeaturePlan | undefined,
): string {
  const shown = pickJourneyRows(journey.steps.length, cuts?.collapsed ?? false);

  const data = collectStepData(journey, secrets).map((text, index) =>
    cuts?.droppedData.has(index) === true ? null : text,
  );

  const hasData = shown.indexes.some((index) => (data[index] ?? null) !== null);

  const rows = shown.indexes.map((index) => {
    const step = requireStep(journey, index);
    const isShort = cuts?.shortCells.has(index) === true;

    return renderJourneyRow(
      {
        number: index + 1,
        step,
        evidenceCell: renderEvidenceCell(step.files, linkHosts, secrets, isShort),
        dataCell: hasData ? formatDataBlock(data[index] ?? null) : null,
      },
      secrets,
    );
  });

  const columns = hasData ? 5 : 4;

  const withGap =
    shown.hidden === 0
      ? rows
      : [
          ...rows.slice(0, shown.gapAfter),
          renderGapRow(shown.hidden, columns),
          ...rows.slice(shown.gapAfter),
        ];

  return ['<table>', renderTableHeader(hasData), ...withGap, '</table>'].join('\n');
}

function requireStep(journey: Journey, index: number): JourneyStep {
  const step = journey.steps[index];

  if (step === undefined) {
    throw new Error(`The journey has no step ${index}.`);
  }

  return step;
}
