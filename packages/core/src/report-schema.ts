import { z } from 'zod';
import { evidenceSchema } from './envelope.ts';

const linkedEvidenceSchema = evidenceSchema.extend({ url: z.string().optional() });

export const verdictSchema = z.strictObject({
  feature: z.string(),
  fingerprint: z.string(),
  run: z.string(),
  at: z.iso.datetime(),
  evidence: z.array(linkedEvidenceSchema),
});

export type Verdict = z.infer<typeof verdictSchema>;

const featureStatusSchema = z.enum(['verified', 'stale', 'missing', 'unchanged']);

export type FeatureStatus = z.infer<typeof featureStatusSchema>;

const featureReportSchema = z.strictObject({
  name: z.string(),
  changed: z.boolean(),
  status: featureStatusSchema,
  verdict: verdictSchema.nullable(),
});

// The report is the one contract that leaves the worktree: the PR body carries it, and `gate` reads
// it back in CI. Its `version` changes only with a change a reader of an older report must handle.
export const reportSchema = z.strictObject({
  version: z.literal(1),
  base: z.string(),
  fingerprint: z.string(),
  complete: z.boolean(),
  features: z.array(featureReportSchema),
});

export type Report = z.infer<typeof reportSchema>;
