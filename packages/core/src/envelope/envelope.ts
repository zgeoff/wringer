import { z } from 'zod';
import { errorCodes } from '../error-codes.ts';
import { envelopeVersion } from './envelope-version.ts';

export const evidenceSchema = z.strictObject({
  kind: z.string().min(1),
  path: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),

  // Optional, so stored runs and verdicts still parse. Absent reads as 'opaque'.
  scrub: z.enum(['text', 'opaque']).optional(),
});

export type Evidence = z.infer<typeof evidenceSchema>;

export const envelopeErrorSchema = z.strictObject({
  code: z.enum(errorCodes),
  message: z.string(),
  hint: z.string().nullable(),
});

export const envelopeSchema = z
  .strictObject({
    wringer: z.literal(envelopeVersion),
    ok: z.boolean(),
    command: z.string().min(1),
    target: z.string().nullable(),
    instance: z.string().nullable(),
    feature: z.string().nullable(),
    sha: z.string().nullable(),
    durationMs: z.number().int().nonnegative(),

    // JSON drops a field that is undefined, so a logged envelope with no data would not read back.
    data: z.unknown().refine((value) => value !== undefined, {
      message: 'an envelope holds its data, or null for none',
    }),
    evidence: z.array(evidenceSchema),
    cursors: z.record(z.string(), z.number().int().nonnegative()),
    truncated: z.literal(true).optional(),
    truncatedPath: z.string().optional(),
    error: envelopeErrorSchema.nullable(),
  })
  .refine((envelope) => envelope.ok === (envelope.error === null), {
    message: 'an envelope has an error exactly when it is not ok',
    path: ['error'],
  })
  .refine((envelope) => (envelope.truncated === true) === (envelope.truncatedPath !== undefined), {
    message: 'a truncated envelope names the path of its full data',
    path: ['truncatedPath'],
  });

export type Envelope = z.infer<typeof envelopeSchema>;

export const streamEventSchema = z.strictObject({
  wringer: z.literal(envelopeVersion),
  event: z.string().min(1),
  data: z.unknown(),
});

export type StreamEvent = z.infer<typeof streamEventSchema>;
