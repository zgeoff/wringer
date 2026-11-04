import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { buildBuiltinCommand } from '../build-commands.ts';
import { buildReport } from '../build-report.ts';
import type { Evidence } from '../envelope.ts';
import { parseReportBlock } from '../parse-report-block.ts';
import { readChangedPaths } from '../read-changed-paths.ts';
import { readDefaultBase } from '../read-default-base.ts';
import { readFingerprint } from '../read-fingerprint.ts';
import { doneCommand, readVerdicts } from '../read-verdicts.ts';
import { renderReportMarkdown } from '../render-report-markdown.ts';
import { reportSchema, verdictSchema } from '../report-schema.ts';
import type { Report, Verdict } from '../report-schema.ts';
import type { BuiltinCommandSpec, BuiltinContext, RegisteredCommand } from '../types.ts';
import { WringerError } from '../wringer-error.ts';

const doneArgsSchema = z.strictObject({ feature: z.string().min(1).optional() });

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
});

type GateData = z.infer<typeof gateDataSchema>;

// `done` turns the evidence of one run into a verdict, `report` merges every verdict of the worktree
// for the PR body, and `gate` checks that report again in CI, with a fingerprint it computes itself.
export function buildVerdictCommands(): readonly RegisteredCommand[] {
  const done: BuiltinCommandSpec<DoneArgs, Verdict> = {
    path: [doneCommand],
    summary: 'Record a verdict for a feature from the drives since the doctor passed',
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
      'Fail when a changed feature lacks a verdict at the current fingerprint in the PR body',
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

  const base = await readDefaultBase(ctx.session.root);
  const fingerprint = await readCurrentFingerprint(ctx, base);

  if (ctx.target.mode === 'launch' && fingerprint !== ctx.run.fingerprint) {
    throw new WringerError('doctor-required', {
      message: 'The working tree changed since this run started.',
      hint: 'Run `up --restart` and `doctor`, then drive the feature again.',
    });
  }

  const drives = ctx.run.drivesAfterDoctor.filter((envelope) => envelope.feature === feature);

  if (drives.length === 0) {
    throw new WringerError('check-failed', {
      message: `No drive of ${feature} passed on run ${ctx.run.runID} since the doctor passed.`,
      hint: `Drive the feature with \`--feature ${feature}\`, then run \`done\` again.`,
    });
  }

  return {
    feature,
    fingerprint,
    run: ctx.run.runID,
    at: ctx.now().toISOString(),
    evidence: drives.flatMap((envelope) => envelope.evidence),
  };
}

function readCurrentFingerprint(ctx: BuiltinContext, base: string): Promise<string> {
  return readFingerprint({ cwd: ctx.session.root, base, exclude: [ctx.wringer.stateDir] });
}

async function readReport(ctx: BuiltinContext, givenBase: string | undefined): Promise<Report> {
  const base = await readBase(ctx, givenBase);

  const [fingerprint, changedPaths, verdicts] = await Promise.all([
    readCurrentFingerprint(ctx, base),
    readChangedPaths({ cwd: ctx.session.root, base, exclude: [ctx.wringer.stateDir] }),
    readVerdicts(ctx.state),
  ]);

  return buildReport({ base, fingerprint, features: ctx.wringer.features, changedPaths, verdicts });
}

function readBase(ctx: BuiltinContext, givenBase: string | undefined): Promise<string> {
  if (givenBase !== undefined) {
    return Promise.resolve(givenBase);
  }

  return readDefaultBase(ctx.session.root);
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

  const body = await readFile(bodyPath, 'utf8');

  const block = parseReportBlock(body);

  const [fingerprint, changedPaths] = await Promise.all([
    readCurrentFingerprint(ctx, args.base),
    readChangedPaths({ cwd: ctx.session.root, base: args.base, exclude: [ctx.wringer.stateDir] }),
  ]);

  const claimed = block.ok
    ? block.report.features.flatMap((feature) =>
        feature.verdict === null ? [] : [[feature.name, feature.verdict] as const],
      )
    : [];

  const verdicts = new Map(claimed);

  const computed = buildReport({
    base: args.base,
    fingerprint,
    features: ctx.wringer.features,
    changedPaths,
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
          reason: `verdict at ${feature.verdict?.fingerprint ?? ''}, tree at ${fingerprint}`,
        },
      ];
    }

    return [];
  });

  const data = { fingerprint, failing };

  if (failing.length > 0) {
    throw new WringerError('check-failed', {
      message: `${failing.length} changed feature(s) lack a verdict at the current fingerprint: ${failing.map((feature) => feature.name).join(', ')}.`,
      hint: 'Drive each feature, run `done` and `report --human`, and update the PR body.',
      data,
    });
  }

  return data;
}
