import type { SecretSet } from './create-secret-set.ts';
import type { Envelope } from './envelope.ts';
import { WringerError } from './wringer-error.ts';

// The data, the error and every path in an envelope pass through the set before the envelope is
// logged, printed or uploaded.
export function scrubEnvelope(envelope: Envelope, secrets: SecretSet): Envelope {
  return {
    ...envelope,
    data: secrets.scrubValue(envelope.data) ?? null,
    evidence: envelope.evidence.map((item) => ({ ...item, path: secrets.scrubText(item.path) })),
    ...(envelope.truncatedPath === undefined
      ? {}
      : { truncatedPath: secrets.scrubText(envelope.truncatedPath) }),
    error:
      envelope.error === null
        ? null
        : {
            ...envelope.error,
            message: secrets.scrubText(envelope.error.message),
            hint: envelope.error.hint === null ? null : secrets.scrubText(envelope.error.hint),
          },
  };
}

// The error keeps its code, and its message, hint and data pass through the set.
export function scrubFailure(
  failure: WringerError | null,
  secrets: SecretSet,
): WringerError | null {
  if (failure === null) {
    return null;
  }

  return new WringerError(failure.code, {
    message: secrets.scrubText(failure.message),
    ...(failure.hint === undefined ? {} : { hint: secrets.scrubText(failure.hint) }),
    data: secrets.scrubValue(failure.data),
  });
}
