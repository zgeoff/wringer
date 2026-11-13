import { collectShownEntries } from './collect-shown-files.ts';
import { isSizedAsLink } from './is-sized-as-link.ts';
import type { ReportDocument } from './report-document.ts';
import type { ReportPlan } from './report-plan.ts';
import type { UploadItem } from './upload-evidence.ts';

// The items `publish` uploads: each file the plan shows as a link, labelled by its feature. Every
// journey in the list uploads, so each item's target uploads.
export function collectUploadItems(
  document: ReportDocument,
  plan: ReportPlan,
  linkChars: number,
): readonly UploadItem[] {
  return collectShownEntries(document, plan).flatMap((entry) => {
    const journey = document.journeys.get(entry.feature);

    if (
      journey === undefined ||
      !isSizedAsLink(journey, entry.file, { linkChars, linkHosts: document.linkHosts })
    ) {
      return [];
    }

    return [
      {
        evidence: entry.file.evidence,
        targetUploads: true,
        label: `${document.registry}/${entry.feature}`,
      },
    ];
  });
}
