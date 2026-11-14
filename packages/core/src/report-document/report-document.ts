import type { Evidence } from '../envelope/envelope.ts';
import type { UploadRefusal } from '../evidence/pick-upload-refusal.ts';
import type { Report } from '../verdict/report-schema.ts';

// Why a journey's evidence stays on this machine.
export type LocalCause =
  | 'target-local'
  | 'recorded-local'
  | 'target-gone'
  | 'no-upload-flag'
  | 'run-log-missing';

export interface JourneyFile {
  readonly evidence: Evidence;

  // Null when the file is gone from the worktree.
  readonly bytes: number | null;

  // The link the file host gave; null while the file stays local.
  readonly url: string | null;

  // Why the upload guard refuses the file, or null when it may leave. A refused file stays local.
  readonly refusal: UploadRefusal['reason'] | null;
}

export interface JourneyStep {
  readonly command: string;
  readonly ok: boolean;

  // The error code of a failed step.
  readonly code: string | null;
  readonly durationMs: number;
  readonly files: readonly JourneyFile[];

  // The envelope's data.
  readonly data: unknown;
}

export interface Journey {
  // The drives that `done` counted, in order; never `use`.
  readonly steps: readonly JourneyStep[];
  readonly evidence: 'upload' | LocalCause;
}

export type FeatureReport = Report['features'][number];

export interface ReportDocument {
  readonly registry: string;
  readonly report: Report;

  // By feature: each feature whose status is `verified`.
  readonly journeys: ReadonlyMap<string, Journey>;

  // The hosts a link may name; empty while nothing uploads.
  readonly linkHosts: readonly string[];
}
