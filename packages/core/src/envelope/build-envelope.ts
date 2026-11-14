import type { WringerError } from '../wringer-error.ts';
import { envelopeVersion } from './envelope-version.ts';
import type { Envelope, Evidence } from './envelope.ts';

export interface EnvelopeInput {
  readonly command: string;
  readonly target: string | null;
  readonly instance: string | null;
  readonly feature: string | null;
  readonly sha: string | null;
  readonly durationMs: number;
  readonly data: unknown;
  readonly evidence: readonly Evidence[];
  readonly cursors: Readonly<Record<string, number>>;
  readonly truncatedPath: string | null;
  readonly error: WringerError | null;
}

export function buildEnvelope(input: EnvelopeInput): Envelope {
  return {
    wringer: envelopeVersion,
    ok: input.error === null,
    command: input.command,
    target: input.target,
    instance: input.instance,
    feature: input.feature,
    sha: input.sha,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    data: input.data ?? null,
    evidence: [...input.evidence],
    cursors: { ...input.cursors },
    ...(input.truncatedPath === null
      ? {}
      : { truncated: true, truncatedPath: input.truncatedPath }),
    error:
      input.error === null
        ? null
        : { code: input.error.code, message: input.error.message, hint: input.error.hint ?? null },
  };
}
