import { buildEnvelope } from '@wringer/core';
import type { Envelope, WringerError } from '@wringer/core';

// A failure before dispatch, such as a parse error, belongs to no target, run or feature.
export function buildFailureEnvelope(command: string, error: WringerError): Envelope {
  return buildEnvelope({
    command,
    target: null,
    instance: null,
    feature: null,
    sha: null,
    durationMs: 0,
    data: null,
    evidence: [],
    cursors: {},
    truncatedPath: null,
    error,
  });
}
