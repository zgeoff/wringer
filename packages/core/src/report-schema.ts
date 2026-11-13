import { z } from 'zod';
import { evidenceSchema } from './envelope.ts';

export const maxNameLength = 64;
const nameSchema = z.string().min(1).max(maxNameLength);

// A patch ID, or 'empty' for a diff with no file. A patch ID is a SHA-1 or a SHA-256 hash in hex.
export const fingerprintSchema = z.union([
  z.literal('empty'),
  z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u),
]);

// The evidence a verdict keeps may carry the link the repo's upload hook gave it.
const linkedEvidenceSchema = evidenceSchema.extend({ url: z.string().optional() });

// What the verdict's run drove: `local` is a launch target, which runs the worktree's own code.
// `unpinned` is an attach target that cannot say which commit it runs.
const pinSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('local') }),
  z.strictObject({
    kind: z.literal('deployed'),
    revision: z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u),
  }),
  z.strictObject({ kind: z.literal('unpinned') }),
]);

const verdictTargetSchema = z.strictObject({
  name: nameSchema,
  evidence: z.enum(['upload', 'local']),
});

// `fingerprint` names the whole diff the run saw and never decides staleness; `featureFingerprint`
// is the diff limited to the feature's scope, at the base the gate will use, and decides it.
export const verdictSchema = z.strictObject({
  feature: nameSchema,
  fingerprint: fingerprintSchema,
  featureFingerprint: fingerprintSchema,
  run: z.string().max(32),
  at: z.iso.datetime(),
  target: verdictTargetSchema,
  pin: pinSchema,
  evidence: z.array(linkedEvidenceSchema),
});

export type Verdict = z.infer<typeof verdictSchema>;

const featureStatusSchema = z.enum(['verified', 'stale', 'missing', 'unchanged', 'unpinned']);

export type FeatureStatus = z.infer<typeof featureStatusSchema>;

const featureReportSchema = z.strictObject({
  name: nameSchema,
  changed: z.boolean(),
  status: featureStatusSchema,
  verdict: verdictSchema.nullable(),
});

// The report is the one contract that leaves the worktree: the PR body carries it, and `gate` reads
// it back in CI.
export const reportSchema = z.strictObject({
  base: z.string(),
  fingerprint: fingerprintSchema,
  complete: z.boolean(),
  features: z.array(featureReportSchema),

  // The changed paths that no feature, shared glob or ignore glob maps.
  unmapped: z.array(z.string()),
});

export type Report = z.infer<typeof reportSchema>;
