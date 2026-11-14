import type { FeatureReport, Journey, LocalCause } from '../report-document/report-document.ts';
import type { SecretSet } from '../secrets/create-secret-set.ts';
import { escapeReportText } from './escape-report-text.ts';
import { formatJourneySize } from './format-journey-size.ts';

// A journey section up to where its table starts: the opening tag, the summary and the note.
export function renderSectionFrame(
  feature: FeatureReport,
  journey: Journey,
  secrets: SecretSet,
): string {
  const note =
    journey.evidence === 'upload'
      ? []
      : [`<p><i>${renderNote(feature, journey.evidence, secrets)}</i></p>`];

  return [
    '<details>',
    `<summary>${escapeReportText(feature.name, secrets)}: ${escapeReportText(formatJourneySize(journey), secrets)}</summary>`,
    '',
    ...note,
  ].join('\n');
}

function renderNote(feature: FeatureReport, cause: LocalCause, secrets: SecretSet): string {
  const target = escapeReportText(feature.verdict?.target.name ?? '', secrets);

  const notes: Readonly<Record<LocalCause, string>> = {
    'target-local': `Evidence stays local: the target ${target} keeps evidence local. Set <code>evidence: 'upload'</code> on it to publish evidence.`,
    'recorded-local':
      'Evidence stays local: the verdict was recorded while its target kept evidence local.',
    'target-gone': `Evidence stays local: the target ${target} is no longer in the registry.`,
    'no-upload-flag': 'Evidence stays local: the report was built with <code>--no-upload</code>.',
    'run-log-missing': 'The run log is gone, so this journey has no rows.',
  };

  return notes[cause];
}
