import type { SecretSet } from './create-secret-set.ts';
import type { Envelope } from './envelope.ts';
import { WringerError } from './wringer-error.ts';

// Every string and object key of an envelope passes through the set before the envelope is logged,
// printed or uploaded. The version, the error code and the hashes stay as they are: they are fixed
// vocabularies and digests that the envelope schema constrains.
export function scrubEnvelope(envelope: Envelope, secrets: SecretSet): Envelope {
  const scrubNullable = (text: string | null): string | null =>
    text === null ? null : secrets.scrubText(text);

  return {
    ...envelope,
    command: secrets.scrubText(envelope.command),
    target: scrubNullable(envelope.target),
    instance: scrubNullable(envelope.instance),
    feature: scrubNullable(envelope.feature),
    sha: scrubNullable(envelope.sha),
    data: secrets.scrubValue(envelope.data) ?? null,
    evidence: envelope.evidence.map((item) => ({
      ...item,
      kind: secrets.scrubText(item.kind),
      path: secrets.scrubText(item.path),
    })),
    cursors: Object.fromEntries(
      Object.entries(envelope.cursors).map(([key, value]) => [secrets.scrubText(key), value]),
    ),
    ...(envelope.truncatedPath === undefined
      ? {}
      : { truncatedPath: secrets.scrubText(envelope.truncatedPath) }),
    error:
      envelope.error === null
        ? null
        : {
            ...envelope.error,
            message: secrets.scrubText(envelope.error.message),
            hint: scrubNullable(envelope.error.hint),
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
