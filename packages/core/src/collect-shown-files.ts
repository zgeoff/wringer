import { isSizedAsLink } from './is-sized-as-link.ts';
import { pickCellFiles } from './pick-cell-files.ts';
import { pickJourneyRows } from './pick-journey-rows.ts';
import type { JourneyFile, ReportDocument } from './report-document.ts';
import type { ReportPlan } from './report-plan.ts';

// The files the plan shows as links: the ones `publish` uploads. Every other file stays local.
export function collectShownFiles(
  document: ReportDocument,
  plan: ReportPlan,
  linkChars: number,
): readonly JourneyFile[] {
  return document.report.features.flatMap((feature) => {
    const journey = document.journeys.get(feature.name);
    const cuts = plan.features.get(feature.name);

    if (journey === undefined || cuts?.omitted === true) {
      return [];
    }

    const rows = pickJourneyRows(journey.steps.length, cuts?.collapsed ?? false);

    return rows.indexes.flatMap((index) =>
      pickCellFiles(
        journey.steps[index]?.files ?? [],
        cuts?.shortCells.has(index) === true,
      ).kept.filter((file) =>
        isSizedAsLink(journey, file, { linkChars, linkHosts: document.linkHosts }),
      ),
    );
  });
}
