import { collectJourneyDrives } from './collect-journey-drives.ts';
import type { StatePort } from './create-file-state.ts';
import type { Envelope } from './envelope.ts';
import { pickJourneyEvidence } from './pick-journey-evidence.ts';
import { readUploadCandidate } from './read-upload-candidate.ts';
import type { Journey, JourneyFile, JourneyStep, ReportDocument } from './report-document.ts';
import type { Report, Verdict } from './report-schema.ts';
import { runIDSchema } from './run-events.ts';
import type { EvidenceFiles, Wringer } from './types.ts';

export interface ReportDocumentOptions {
  readonly isUploadAllowed: boolean;
}

export interface ReportDocumentDependencies {
  readonly wringer: Wringer;
  readonly state: StatePort;
  readonly files: EvidenceFiles;
  readonly root: string;
  readonly stateDir: string;
}

// Reads the run log of each verified feature's verdict and builds the journey from it. Nothing
// uploads: every file keeps no link.
export async function readReportDocument(
  dependencies: ReportDocumentDependencies,
  report: Report,
  options: ReportDocumentOptions,
): Promise<ReportDocument> {
  const entries = await Promise.all(
    report.features.flatMap((feature) =>
      feature.status === 'verified' && feature.verdict !== null
        ? [readJourney(dependencies, feature.verdict, options.isUploadAllowed)]
        : [],
    ),
  );

  return {
    registry: dependencies.wringer.name,
    report,
    journeys: new Map(entries),
    linkHosts: [],
  };
}

async function readJourney(
  dependencies: ReportDocumentDependencies,
  verdict: Verdict,
  isUploadAllowed: boolean,
): Promise<readonly [string, Journey]> {
  const drives = await readDrives(dependencies, verdict);

  const target = dependencies.wringer.targets.get(verdict.target.name);

  const evidence = pickJourneyEvidence({
    verdict,
    targetEvidence: target === undefined ? null : (target.evidence ?? 'local'),
    hasRunLog: drives !== null,
    isUploadAllowed,
  });

  const steps = await Promise.all(
    (drives ?? []).map((envelope) => readStep(dependencies, envelope)),
  );

  return [verdict.feature, { steps, evidence }];
}

async function readDrives(
  dependencies: ReportDocumentDependencies,
  verdict: Verdict,
): Promise<readonly Envelope[] | null> {
  const runID = runIDSchema.safeParse(verdict.run);

  if (!runID.success) {
    return null;
  }

  const events = await dependencies.state.readRunEvents(runID.data);

  return collectJourneyDrives(events, verdict.feature);
}

async function readStep(
  dependencies: ReportDocumentDependencies,
  envelope: Envelope,
): Promise<JourneyStep> {
  const files = await Promise.all(
    envelope.evidence.map(async (evidence): Promise<JourneyFile> => {
      const candidate = await readUploadCandidate(evidence, dependencies);

      const isReadable =
        candidate.exists && candidate.isInFeaturesFolder && candidate.isRegularFile;

      const content = isReadable ? await dependencies.files.readBytes(candidate.realPath) : null;

      return { evidence, bytes: content === null ? null : content.byteLength, url: null };
    }),
  );

  return {
    command: envelope.command.replaceAll('.', ' '),
    ok: envelope.ok,
    code: envelope.error?.code ?? null,
    durationMs: envelope.durationMs,
    files,
    data: envelope.data,
  };
}
