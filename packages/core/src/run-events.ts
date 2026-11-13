import { z } from 'zod';
import { envelopeSchema } from './envelope.ts';
import { fingerprintSchema } from './report-schema.ts';

export const runIDSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{2,40}$/u);

export type RunID = z.infer<typeof runIDSchema>;

export const modeSchema = z.enum(['launch', 'attach']);

export type Mode = z.infer<typeof modeSchema>;

export const endpointsSchema = z.record(z.string(), z.string());

export type Endpoints = z.infer<typeof endpointsSchema>;

export const checkResultSchema = z.strictObject({
  name: z.string(),
  status: z.enum(['passed', 'failed']),
  durationMs: z.number().int().nonnegative(),
  code: z.string().nullable(),
  message: z.string().nullable(),
});

export type CheckResult = z.infer<typeof checkResultSchema>;

const at = z.iso.datetime();

export const revisionSchema = z.string().regex(/^[0-9a-f]{7,64}$/u);

// Entries, not a record: a record drops a feature named `__proto__`.
const featureFingerprintsSchema = z.array(z.tuple([z.string(), fingerprintSchema]));

// A command's work that failed after the envelope had already answered with a timeout.
export const lateFailureEventSchema = z.strictObject({
  type: z.literal('late-failure'),
  at,
  command: z.string(),
  code: z.string(),
  message: z.string(),
});

export type LateFailureEvent = z.infer<typeof lateFailureEventSchema>;

export const runEventSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('run-started'),
    at,
    target: z.string(),
    mode: modeSchema,
    fingerprint: z.string(),
  }),
  z.strictObject({
    type: z.literal('supervisor-ready'),
    at,
    pid: z.number().int(),
    socket: z.string(),
  }),
  z.strictObject({
    type: z.literal('scopes-read'),
    at,
    featureFingerprints: featureFingerprintsSchema,
  }),
  z.strictObject({ type: z.literal('revision-read'), at, revision: revisionSchema }),
  z.strictObject({ type: z.literal('launch-ready'), at, endpoints: endpointsSchema }),
  z.strictObject({ type: z.literal('service-ready'), at, service: z.string() }),
  z.strictObject({ type: z.literal('run-ready'), at }),
  z.strictObject({
    type: z.enum(['doctor-passed', 'doctor-failed']),
    at,
    results: z.array(checkResultSchema),
  }),
  z.strictObject({ type: z.literal('envelope'), at, drive: z.boolean(), envelope: envelopeSchema }),
  z.strictObject({ type: z.literal('internal-error'), at, command: z.string(), stack: z.string() }),

  lateFailureEventSchema,
  z.strictObject({ type: z.literal('crashed'), at, reason: z.string() }),
  z.strictObject({ type: z.literal('run-ended'), at }),
]);

export type RunEvent = z.infer<typeof runEventSchema>;

export type RunEventType = RunEvent['type'];
