import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { buildChangeFactsRequest } from '../build-change-request.ts';
import { buildBuiltinCommand } from '../build-commands.ts';
import { buildReport } from '../build-report.ts';
import type { Evidence } from '../envelope.ts';
import { parseReportBlock } from '../parse-report-block.ts';
import { readChangeFacts } from '../read-change-facts.ts';
import type { ChangeFacts } from '../read-change-facts.ts';
import { readDefaultBase } from '../read-default-base.ts';
import { doneCommand, readVerdicts } from '../read-verdicts.ts';
import { renderReportMarkdown } from '../render-report-markdown.ts';
import { reportSchema, verdictSchema } from '../report-schema.ts';
import type { Report, Verdict } from '../report-schema.ts';
import type { BuiltinCommandSpec, BuiltinContext, RegisteredCommand } from '../types.ts';
import { WringerError } from '../wringer-error.ts';

const doneArgsSchema = z.strictObject({
  feature: z.string().min(1).optional(),
  base: z.string().min(1).optional(),
});

type DoneArgs = z.infer<typeof doneArgsSchema>;

const reportArgsSchema = z.strictObject({ base: z.string().min(1).optional() });

type ReportArgs = z.infer<typeof reportArgsSchema>;

const reportDataSchema = z.strictObject({ report: reportSchema, markdown: z.string() });

type ReportData = z.infer<typeof reportDataSchema>;

const gateArgsSchema = z.strictObject({ base: z.string().min(1), bodyFile: z.string().min(1) });

type GateArgs = z.infer<typeof gateArgsSchema>;

const gateFailureSchema = z.strictObject({ name: z.string(), reason: z.string() });

const gateDataSchema = z.strictObject({
  fingerprint: z.string(),
  failing: z.array(gateFailureSchema),
  unmapped: z.array(z.string()),
});

type GateData = z.infer<typeof gateDataSchema>;

// `done` turns the evidence of one run into a verdict, `report` merges every verdict of the worktree
// for the PR body, and `gate` checks that report again in CI, with a fingerprint it computes itself.
export function buildVerdictCommands(): readonly RegisteredCommand[] {
  const done: BuiltinCommandSpec<DoneArgs, Verdict> = {
    path: [doneCommand],
    summary:
      'Record a verdict for a feature from its commands that touched the app since the doctor passed',
    args: doneArgsSchema,
    data: verdictSchema,
    effect: 'read',
    needsRun: true,
    needsDoctor: false,
    run: (args, ctx) => recordVerdict(args, ctx),
  };

  const report: BuiltinCommandSpec<ReportArgs, ReportData> = {
    path: ['report'],
    summary: 'Merge the verdicts into a report: JSON for a gate, Markdown with --human for the PR',
    args: reportArgsSchema,
    data: reportDataSchema,
    effect: 'read',
    needsRun: false,
    needsDoctor: false,
    run: async (args, ctx) => {
      const built = await readReport(ctx, args.base);
      const linked = await linkEvidence(ctx, built);

      return { report: linked, markdown: renderReportMarkdown(linked) };
    },
  };

  const gate: BuiltinCommandSpec<GateArgs, GateData> = {
    path: ['gate'],
    summary:
      'Fail when a changed feature lacks a verdict at the current fingerprint in the PR body, or a changed path maps to no feature',
    args: gateArgsSchema,
    data: gateDataSchema,
    effect: 'read',
    needsRun: false,
    needsDoctor: false,
    run: (args, ctx) => checkGate(args, ctx),
  };

  return [buildBuiltinCommand(done), buildBuiltinCommand(report), buildBuiltinCommand(gate)];
}

async function recordVerdict(args: DoneArgs, ctx: BuiltinContext): Promise<Verdict> {
  const feature = args.feature ?? ctx.feature;

  if (feature === null) {
    throw new WringerError('usage', {
      message: 'No feature is set.',
      hint: 'Pass `--feature <name>`, or run `use --feature <name>` first.',
    });
  }

  if (ctx.run?.doctor !== 'passed') {
    throw new WringerError('doctor-required', {
      message: `The doctor has not passed on run ${ctx.run?.runID ?? 'none'}.`,
      hint: 'Run `doctor`, then drive the feature again.',
    });
  }

  // The run read its feature fingerprints at the default base, so the launch check uses that base;
  // the verdict takes the base the PR's gate will use.
  const defaultBase = await readDefaultBase(ctx.session.repoHost, ctx.session.root);
  const treeFacts = await readCurrentFacts(ctx, defaultBase);

  const treeFingerprint = treeFacts.featureFingerprints.get(feature);

  if (treeFingerprint === undefined) {
    throw new WringerError('usage', {
      message: `\`${feature}\` is not a feature of the registry.`,
      hint: 'Pass the name of a feature the registry lists.',
    });
  }

  if (ctx.target.mode === 'launch' && ctx.run.scopesRead?.get(feature) !== treeFingerprint) {
    throw new WringerError('doctor-required', {
      message: `The files of ${feature} changed since this run started, or the run recorded none.`,
      hint: 'Run `up --restart` and `doctor`, then drive the feature again.',
    });
  }

  const drives = ctx.run.drivesAfterDoctor.filter((envelope) => envelope.feature === feature);

  if (drives.length === 0) {
    throw new WringerError('check-failed', {
      message: `No command of ${feature} that touches the app passed on run ${ctx.run.runID} since the doctor passed.`,
      hint: `Drive the feature with \`--feature ${feature}\`, then run \`done\` again.`,
    });
  }

  const scopeFacts =
    args.base === undefined || args.base === defaultBase
      ? treeFacts
      : await readCurrentFacts(ctx, args.base);

  return {
    feature,
    fingerprint: scopeFacts.fingerprint,
    featureFingerprint: scopeFacts.featureFingerprints.get(feature) ?? treeFingerprint,
    run: ctx.run.runID,
    at: ctx.now().toISOString(),
    target: { name: ctx.targetName, evidence: 'local' },
    pin: ctx.target.mode === 'launch' ? { kind: 'local' } : { kind: 'unpinned' },
    evidence: drives.flatMap((envelope) => envelope.evidence),
  };
}

function readCurrentFacts(ctx: BuiltinContext, base: string): Promise<ChangeFacts> {
  return readChangeFacts(
    ctx.session.repoHost,
    buildChangeFactsRequest(ctx.wringer, ctx.session.root, base),
  );
}

async function readReport(ctx: BuiltinContext, givenBase: string | undefined): Promise<Report> {
  const base = await readBase(ctx, givenBase);

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
  });
}

function readBase(ctx: BuiltinContext, givenBase: string | undefined): Promise<string> {
  if (givenBase !== undefined) {
    return Promise.resolve(givenBase);
  }

  return readDefaultBase(ctx.session.repoHost, ctx.session.root);
}

// The repo's upload hook turns each local evidence file into a link; the local files never leave
// the worktree otherwise.
async function linkEvidence(ctx: BuiltinContext, report: Report): Promise<Report> {
  const upload = ctx.wringer.hooks.upload;

  if (upload === undefined) {
    return report;
  }

  const link = async (evidence: Evidence): Promise<Evidence & { readonly url?: string }> => ({
    ...evidence,
    url: await upload({ ...evidence, path: join(ctx.session.root, evidence.path) }),
  });

  const features = await Promise.all(
    report.features.map(async (feature) => {
      if (feature.verdict === null || feature.status !== 'verified') {
        return feature;
      }

      const evidence = await Promise.all(feature.verdict.evidence.map((item) => link(item)));

      return { ...feature, verdict: { ...feature.verdict, evidence } };
    }),
  );

  return { ...report, features };
}

async function checkGate(args: GateArgs, ctx: BuiltinContext): Promise<GateData> {
  const bodyPath = isAbsolute(args.bodyFile)
    ? args.bodyFile
    : join(ctx.session.root, args.bodyFile);

  const body = await ctx.session.repoHost.readText(bodyPath);

  const block = parseReportBlock(body);

  const facts = await readCurrentFacts(ctx, args.base);

  const claimed = block.ok
    ? block.report.features.flatMap((feature) =>
        feature.verdict === null ? [] : [[feature.name, feature.verdict] as const],
      )
    : [];

  const verdicts = new Map(claimed);

  const computed = buildReport({
    base: args.base,
    fingerprint: facts.fingerprint,
    features: ctx.wringer.features,
    featureFingerprints: facts.featureFingerprints,
    changedPaths: facts.changedPaths,
    shared: ctx.wringer.shared,
    ignore: ctx.wringer.ignore,
    verdicts,
  });

  const failing = computed.features.flatMap((feature) => {
    if (feature.status === 'missing') {
      return [{ name: feature.name, reason: block.ok ? 'no verdict in the report' : block.reason }];
    }

    if (feature.status === 'stale') {
      return [
        {
          name: feature.name,
          reason: `verdict at ${feature.verdict?.featureFingerprint ?? ''}, tree at ${facts.featureFingerprints.get(feature.name) ?? ''}`,
        },
      ];
    }

    return [];
  });

  const data = { fingerprint: facts.fingerprint, failing, unmapped: computed.unmapped };

  if (failing.length > 0 || computed.unmapped.length > 0) {
    throw new WringerError('check-failed', {
      message: formatGateFailure(failing, computed.unmapped),
      hint: pickGateHint(failing, computed.unmapped),
      data,
    });
  }

  return data;
}

function formatGateFailure(
  failing: readonly { readonly name: string }[],
  unmapped: readonly string[],
): string {
  const lines = [
    failing.length > 0
      ? `${failing.length} changed feature(s) lack a verdict at the current fingerprint: ${failing.map((feature) => feature.name).join(', ')}.`
      : null,
    unmapped.length > 0
      ? `${unmapped.length} changed path(s) map to no feature: ${unmapped.join(', ')}.`
      : null,
  ];

  return lines.filter((line) => line !== null).join(' ');
}

const verdictHint = 'Drive each feature, run `done` and `report --human`, and update the PR body.';

const unmappedHint =
  "Add each unmapped path to a feature's `paths`, or to the registry's ignore list when it has no runtime effect.";

function pickGateHint(failing: readonly unknown[], unmapped: readonly string[]): string {
  if (unmapped.length === 0) {
    return verdictHint;
  }

  return failing.length === 0 ? unmappedHint : `${unmappedHint} ${verdictHint}`;
}
