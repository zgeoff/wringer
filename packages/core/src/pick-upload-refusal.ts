import type { SecretSet } from './create-secret-set.ts';
import type { Evidence } from './envelope.ts';

export interface UploadCandidate {
  readonly evidence: Evidence;
  readonly exists: boolean;

  // After symlinks are resolved.
  readonly realPath: string;

  // The real path sits in `<stateDir>/runs/<runID>/features/`.
  readonly isInFeaturesFolder: boolean;

  // From lstat: a symlink is not one.
  readonly isRegularFile: boolean;

  // Of the bytes read now.
  readonly sha256: string | null;

  // The decoded bytes, when `evidence.scrub` is 'text'.
  readonly text: string | null;
}

type UploadRefusalReason =
  | 'missing'
  | 'outside-features-folder'
  | 'not-a-regular-file'
  | 'hash-mismatch'
  | 'opaque-on-local-target'
  | 'secret-found';

export interface UploadRefusal {
  readonly reason: UploadRefusalReason;
  readonly path: string;
}

export interface UploadPolicy {
  // True only when the verdict's target sets `evidence: 'upload'`. A caller that cannot tell the
  // verdict's target passes false.
  readonly targetUploads: boolean;
  readonly secrets: SecretSet;
}

// The first refusal, in the order of `UploadRefusalReason`, or null for a file that may leave.
export function pickUploadRefusal(
  candidate: UploadCandidate,
  policy: UploadPolicy,
): UploadRefusal | null {
  const reason = pickReason(candidate, policy);

  return reason === null ? null : { reason, path: candidate.evidence.path };
}

function pickReason(candidate: UploadCandidate, policy: UploadPolicy): UploadRefusalReason | null {
  if (!candidate.exists) {
    return 'missing';
  }

  if (!candidate.isInFeaturesFolder) {
    return 'outside-features-folder';
  }

  if (!candidate.isRegularFile) {
    return 'not-a-regular-file';
  }

  if (candidate.sha256 !== candidate.evidence.sha256) {
    return 'hash-mismatch';
  }

  const isText = candidate.evidence.scrub === 'text';

  if (!isText && !policy.targetUploads) {
    return 'opaque-on-local-target';
  }

  if (candidate.text !== null && policy.secrets.findSecret(candidate.text) !== null) {
    return 'secret-found';
  }

  return null;
}
