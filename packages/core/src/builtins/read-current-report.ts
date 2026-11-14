import type { BuiltinContext } from '../types.ts';
import { buildReport } from '../verdict/build-report.ts';
import { readVerdicts } from '../verdict/read-verdicts.ts';
import type { Report } from '../verdict/report-schema.ts';
import { readCurrentFacts } from './read-current-facts.ts';

// Merges every verdict of the worktree with the change facts against a base.
export async function readCurrentReport(ctx: BuiltinContext, base: string): Promise<Report> {
  const [facts, verdicts] = await Promise.all([
    readCurrentFacts(ctx, base),
    readVerdicts(ctx.state, ctx.session.repoHost, ctx.session.root),
  ]);

  return buildReport({
    base,
    fingerprint: facts.fingerprint,
    features: ctx.wringer.features,
    featureFingerprints: facts.featureFingerprints,
    changedPaths: facts.changedPaths,
    shared: ctx.wringer.shared,
    ignore: ctx.wringer.ignore,
    verdicts,
    policy: ctx.wringer.gate,
  });
}
