import { match } from 'ts-pattern';
import type { FeatureReport, Journey, ReportDocument } from '../report-document/report-document.ts';
import { reportMarkers } from '../report-document/report-markers.ts';
import { collectStepData } from '../report/collect-step-data.ts';
import { formatDataBlock } from '../report/format-data-block.ts';
import { renderDataComment } from '../report/render-data-comment.ts';
import { renderJourneyRow } from '../report/render-journey-row.ts';
import { renderOmittedSection } from '../report/render-omitted-section.ts';
import { renderSectionFrame } from '../report/render-section-frame.ts';
import { renderSummaryTable } from '../report/render-summary-table.ts';
import { renderUnmappedLine } from '../report/render-unmapped-line.ts';
import type { SecretSet } from '../secrets/create-secret-set.ts';
import { isSizedAsLink } from './is-sized-as-link.ts';
import { measureEvidenceCell } from './measure-evidence-cell.ts';
import { measureJourneyTable } from './measure-journey-table.ts';
import type { RowSize } from './measure-journey-table.ts';
import { pickJourneyRows } from './pick-journey-rows.ts';
import { reportCutLimits } from './report-cut-limits.ts';
import type { FeaturePlan, ReportPlan } from './report-plan.ts';

export interface PlanOptions {
  // The span's budget, markers and data comment included.
  readonly budgetChars: number;

  // The uploader's `maxURLLength`, or 0 when nothing uploads.
  readonly linkChars: number;
}

export type PlanResult =
  | { readonly ok: true; readonly plan: ReportPlan; readonly chars: number }
  | { readonly ok: false; readonly minimumChars: number };

// Fits the report into the budget in one pass: it sizes each fragment once, then takes the cuts in
// a fixed order, until the total fits. Links are sized at `linkChars`, so the rendered length equals
// the planned length when every link has that length, and is shorter otherwise.
export function planReport(
  document: ReportDocument,
  options: PlanOptions,
  secrets: SecretSet,
): PlanResult {
  const sized = withSizingLinks(document, options.linkChars);
  const models = buildModels(sized, { secrets, linkChars: options.linkChars });
  const fixedChars = measureFixedParts(document, models.length, secrets);
  const total = { chars: fixedChars + models.reduce((sum, model) => sum + measureModel(model), 0) };
  const counts = { droppedData: 0, collapsed: 0, shortCells: 0, omitted: 0 };

  for (const candidate of collectCandidates(models)) {
    if (total.chars <= options.budgetChars) {
      break;
    }

    const before = measureModel(candidate.model);
    const kind = applyCandidate(candidate);

    if (kind === null) {
      continue;
    }

    const saving = before - measureModel(candidate.model);

    if (saving < 0) {
      revertCandidate(candidate);
      continue;
    }

    counts[kind] += 1;
    total.chars -= saving;
  }

  if (total.chars > options.budgetChars) {
    return { ok: false, minimumChars: total.chars };
  }

  return { ok: true, plan: { cuts: counts, features: toFeaturePlans(models) }, chars: total.chars };
}

// Marks each file the plan sizes as a link with a `url`. The measure counts a link at `linkChars`
// and never reads the marker's text.
function withSizingLinks(document: ReportDocument, linkChars: number): ReportDocument {
  const url = `https://${document.linkHosts[0] ?? ''}/`;

  const journeys = new Map(
    [...document.journeys].map(([name, journey]) => [
      name,
      {
        ...journey,
        steps: journey.steps.map((step) => ({
          ...step,
          files: step.files.map((file) =>
            isSizedAsLink(journey, file, { linkChars, linkHosts: document.linkHosts })
              ? { ...file, url }
              : { ...file, url: null },
          ),
        })),
      },
    ]),
  );

  return { ...document, journeys };
}

interface CutState {
  collapsed: boolean;
  omitted: boolean;
  readonly droppedData: Set<number>;
  readonly shortCells: Set<number>;
}

interface FeatureModel {
  readonly name: string;
  readonly position: number;
  readonly rows: readonly RowSize[];
  readonly fileCounts: readonly number[];

  // The section's length with no table: the frame and the closing tag.
  readonly frameChars: number;
  readonly omittedChars: number;
  readonly state: CutState;
}

interface SizingContext {
  readonly secrets: SecretSet;
  readonly linkChars: number;
}

function buildModels(document: ReportDocument, context: SizingContext): readonly FeatureModel[] {
  return document.report.features.flatMap((feature, position) => {
    const journey = document.journeys.get(feature.name);

    return journey === undefined ? [] : [buildModel(feature, journey, position, context)];
  });
}

function buildModel(
  feature: FeatureReport,
  journey: Journey,
  position: number,
  context: SizingContext,
): FeatureModel {
  const secrets = context.secrets;
  const data = collectStepData(journey, secrets);

  const rows = journey.steps.map((step, index): RowSize => {
    const full = measureEvidenceCell(step.files, secrets, { ...context, shortened: false });
    const short = measureEvidenceCell(step.files, secrets, { ...context, shortened: true });
    const cells = { number: index + 1, step, evidenceCell: '' };
    const text = data[index] ?? null;

    return {
      plain: renderJourneyRow({ ...cells, dataCell: null }, secrets).length + full,
      withColumn: renderJourneyRow({ ...cells, dataCell: '' }, secrets).length + full,
      shortSaving: full - short,
      dataChars: text === null ? null : formatDataBlock(text).length,
    };
  });

  return {
    name: feature.name,
    position,
    rows,
    fileCounts: journey.steps.map((step) => step.files.length),
    frameChars: renderSectionFrame(feature, journey, secrets).length + 1 + '</details>'.length,
    omittedChars: renderOmittedSection(feature, journey, secrets).length,
    state: { collapsed: false, omitted: false, droppedData: new Set(), shortCells: new Set() },
  };
}

// The parts no cut touches, and the separators between all the parts.
function measureFixedParts(
  document: ReportDocument,
  sectionCount: number,
  secrets: SecretSet,
): number {
  const parts = [
    reportMarkers.open,
    renderSummaryTable(document, secrets),
    ...renderUnmappedLine(document.report.unmapped, secrets),
    renderDataComment(document, secrets),
  ];

  const partCount = parts.length + sectionCount;
  const separators = 2 * (partCount - 1);

  return (
    parts.reduce((sum, part) => sum + part.length, 0) + separators + 1 + reportMarkers.close.length
  );
}

function measureModel(model: FeatureModel): number {
  if (model.state.omitted) {
    return model.omittedChars;
  }

  return model.rows.length === 0
    ? model.frameChars
    : model.frameChars + 1 + measureJourneyTable(model.rows, model.state);
}

type Candidate =
  | { readonly kind: 'data'; readonly model: FeatureModel; readonly index: number }
  | { readonly kind: 'collapse'; readonly model: FeatureModel }
  | { readonly kind: 'cell'; readonly model: FeatureModel; readonly index: number }
  | { readonly kind: 'omit'; readonly model: FeatureModel };

// The cuts in their fixed order. Within a kind, a tie goes to the later feature, then the later
// step. The order does not depend on the budget.
function collectCandidates(models: readonly FeatureModel[]): readonly Candidate[] {
  const data = models
    .flatMap((model) =>
      model.rows.flatMap((row, index) =>
        row.dataChars === null ? [] : [{ model, index, size: row.dataChars }],
      ),
    )
    .toSorted((left, right) => right.size - left.size || compareLater(left, right));

  const collapse = models
    .filter((model) => model.rows.length >= reportCutLimits.collapseFromRows)
    .map((model) => ({
      model,
      index: 0,
      size: measureJourneyTable(model.rows, { ...model.state, collapsed: false }),
    }))
    .toSorted((left, right) => right.size - left.size || compareLater(left, right));

  const cells = models
    .flatMap((model) =>
      model.fileCounts.flatMap((count, index) =>
        count >= reportCutLimits.shortenFromFiles ? [{ model, index, size: count }] : [],
      ),
    )
    .toSorted((left, right) => right.size - left.size || compareLater(left, right));

  const omit = models
    .map((model) => ({ model, index: 0, size: measureModel(model) }))
    .toSorted((left, right) => right.size - left.size || compareLater(left, right));

  return [
    ...data.map((entry): Candidate => ({ kind: 'data', model: entry.model, index: entry.index })),
    ...collapse.map((entry): Candidate => ({ kind: 'collapse', model: entry.model })),
    ...cells.map((entry): Candidate => ({ kind: 'cell', model: entry.model, index: entry.index })),
    ...omit.map((entry): Candidate => ({ kind: 'omit', model: entry.model })),
  ];
}

interface Ranked {
  readonly model: FeatureModel;
  readonly index: number;
}

// Orders the later feature first, and within it the later step.
function compareLater(left: Ranked, right: Ranked): number {
  return right.model.position - left.model.position || right.index - left.index;
}

// Takes the cut, and names its count; null when the cut changes nothing, such as a cell the
// collapse already hid.
function applyCandidate(candidate: Candidate): keyof ReportPlan['cuts'] | null {
  const state = candidate.model.state;

  if (candidate.kind === 'data') {
    state.droppedData.add(candidate.index);

    return 'droppedData';
  }

  if (candidate.kind === 'collapse') {
    state.collapsed = true;

    return 'collapsed';
  }

  if (candidate.kind === 'omit') {
    state.omitted = true;

    return 'omitted';
  }

  const shown = pickJourneyRows(candidate.model.rows.length, state.collapsed).indexes;

  if (!shown.includes(candidate.index)) {
    return null;
  }

  state.shortCells.add(candidate.index);

  return 'shortCells';
}

// Undoes a cut that made its section longer, such as the one-line omission of an empty journey.
// Each candidate is the only one of its kind for its model and index, so the state it set was unset.
function revertCandidate(candidate: Candidate): void {
  const state = candidate.model.state;

  match(candidate)
    .with({ kind: 'data' }, (data) => state.droppedData.delete(data.index))
    .with({ kind: 'collapse' }, () => {
      state.collapsed = false;
    })
    .with({ kind: 'cell' }, (cell) => state.shortCells.delete(cell.index))
    .with({ kind: 'omit' }, () => {
      state.omitted = false;
    })
    .exhaustive();
}

function toFeaturePlans(models: readonly FeatureModel[]): ReadonlyMap<string, FeaturePlan> {
  return new Map(
    models
      .filter(
        (model) =>
          model.state.omitted ||
          model.state.collapsed ||
          model.state.droppedData.size > 0 ||
          model.state.shortCells.size > 0,
      )
      .map((model): [string, FeaturePlan] => [
        model.name,
        {
          omitted: model.state.omitted,
          collapsed: model.state.collapsed,
          droppedData: new Set(model.state.droppedData),
          shortCells: new Set(model.state.shortCells),
        },
      ]),
  );
}
