import type { Envelope } from '@wringer/core';
import { match } from 'ts-pattern';
import type { OutputMode } from './pick-output-mode.ts';
import { renderBriefEnvelope } from './render-brief-envelope.ts';
import { renderHumanEnvelope } from './render-human-envelope.ts';

export function renderEnvelope(envelope: Envelope, mode: OutputMode): string {
  return match(mode)
    .with('json', () => `${JSON.stringify(envelope)}\n`)
    .with('human', () => renderHumanEnvelope(envelope))
    .with('brief', () => renderBriefEnvelope(envelope))
    .exhaustive();
}
