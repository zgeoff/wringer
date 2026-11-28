import { readDeletedPaths } from '../import-walk/read-deleted-paths.ts';
import { resolveFeatures } from '../import-walk/resolve-features.ts';
import type { BuiltinContext } from '../types.ts';
import { buildReport } from '../verdict/build-report.ts';
import { readVerdicts } from '../verdict/read-verdicts.ts';
import type { Report } from '../verdict/report-schema.ts';
import { readCurrentFacts } from './read-current-facts.ts';

// Merges every verdict of the worktree with the change facts against a base.
export async function readCurrentReport(ctx: BuiltinContext, base: string): Promise<Report> {
  const resolved = await resolveFeatures(ctx.session.repoHost, ctx.wringer, ctx.session.root);

  const wringer = resolved.wringer;

  const [facts, verdicts] = await Promise.all([
    readCurrentFacts(ctx, wringer, base),
    readVerdicts(ctx.state, ctx.session.repoHost, ctx.session.root),
  ]);

  const deleted = await readDeletedPaths(ctx.session.repoHost, {
    wringer,
    root: ctx.session.root,
    changedPaths: facts.changedPaths,
  });

  return buildReport({
    base,
    fingerprint: facts.fingerprint,
    features: wringer.features,
    featureFingerprints: facts.featureFingerprints,
    changedPaths: facts.changedPaths,
    renamedFrom: [...facts.renamedFrom, ...deleted],
    shared: wringer.shared,
    ignore: wringer.ignore,
    verdicts,
    policy: wringer.gate,
  });
}
