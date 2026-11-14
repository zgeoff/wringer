import type { Envelope } from '@wringer/core';
import type { OutputMode } from './pick-output-mode.ts';
import { renderHumanEnvelope } from './render-human-envelope.ts';

export function renderEnvelope(envelope: Envelope, mode: OutputMode): string {
  return mode === 'json' ? `${JSON.stringify(envelope)}\n` : renderHumanEnvelope(envelope);
}
