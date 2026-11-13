import { isAbsolute, join } from 'node:path';
import invariant from 'tiny-invariant';
import { z } from 'zod';
import { buildChangeFactsRequest } from '../build-change-request.ts';
import { buildBuiltinCommand } from '../build-commands.ts';
import { buildReport } from '../build-report.ts';
import { readChangeFacts } from '../read-change-facts.ts';
import type { ChangeFacts } from '../read-change-facts.ts';
import { readDefaultBase } from '../read-default-base.ts';
import { readReportDocument } from '../read-report-document.ts';
import { doneCommand } from '../read-verdicts.ts';
import { renderReport } from '../render-report.ts';
import { parseReportComment } from '../report-comment.ts';
import type { CommentRead } from '../report-comment.ts';
import { noCuts } from '../report-plan.ts';
import {
  featureStatusSchema,
  maxBaseLength,
  maxNameLength,
  reportSchema,
  verdictSchema,
} from '../report-schema.ts';
import type { Claim, Pin, Report, Verdict } from '../report-schema.ts';
import type { BuiltinCommandSpec, BuiltinContext, RegisteredCommand } from '../types.ts';
import { WringerError } from '../wringer-error.ts';
import { buildDeployedPin } from './build-deployed-pin.ts';
import { buildPublishCommand } from './build-publish-command.ts';
import { readCurrentFacts } from './read-current-facts.ts';
import { readCurrentReport } from './read-current-report.ts';
import { readDeployedCommit } from './read-deployed-commit.ts';

const doneArgsSchema = z.strictObject({
  feature: z.string().min(1).optional(),
  base: z.string().min(1).optional(),
});

type DoneArgs = z.infer<typeof doneArgsSchema>;

const reportArgsSchema = z.strictObject({
  base: z.string().min(1).max(maxBaseLength).optional(),
});

type ReportArgs = z.infer<typeof reportArgsSchema>;

const reportDataSchema = z.strictObject({ report: reportSchema, markdown: z.string() });

type ReportData = z.infer<typeof reportDataSchema>;

const gateArgsSchema = z.strictObject({ base: z.string().min(1), bodyFile: z.string().min(1) });

type GateArgs = z.infer<typeof gateArgsSchema>;

const gateFailureSchema = z.strictObject({
  name: z.string(),
  reason: z.string(),
  status: featureStatusSchema,
});

const gateDataSchema = z.strictObject({
  fingerprint: z.string(),
  failing: z.array(gateFailureSchema),
  unmapped: z.array(z.string()),
  unknownClaims: z.array(z.string().min(1).max(maxNameLength)),
});

type GateData = z.infer<typeof gateDataSchema>;

// `done` turns the evidence of one run into a verdict, `report` merges every verdict of the worktree
// for the PR body, `publish` writes that report into the PR, and `gate` checks it again in CI, with a
// fingerprint it computes itself.
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
      const base = await readBase(ctx, args.base);
      const built = await readCurrentReport(ctx, base);

      const document = await readReportDocument(
        {
          wringer: ctx.wringer,
          state: ctx.state,
          files: ctx.session.repoHost,
          root: ctx.session.root,
          stateDir: ctx.stateDir,
          secrets: ctx.secrets,
        },
        built,
        { isUploadAllowed: false, linkHosts: [] },
      );

      return { report: built, markdown: renderReport(document, noCuts, ctx.secrets) };
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

  return [
    buildBuiltinCommand(done),
    buildBuiltinCommand(report),
    buildBuiltinCommand(gate),
    buildPublishCommand(),
  ];
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

  if (!ctx.wringer.features.some((definition) => definition.name === feature)) {
    throw new WringerError('usage', {
      message: `\`${feature}\` is not a feature of the registry.`,
      hint: 'Pass the name of a feature the registry lists.',
    });
  }

  const drives = ctx.run.drivesAfterDoctor.filter((envelope) => envelope.feature === feature);

  if (drives.length === 0) {
    throw new WringerError('check-failed', {
      message: `No command of ${feature} that touches the app passed on run ${ctx.run.runID} since the doctor passed.`,
      hint: `Drive the feature with \`--feature ${feature}\`, then run \`done\` again.`,
    });
  }

  // The run read its feature fingerprints at the default base, so the launch check uses that base;
  // the verdict takes the base the PR's gate will use.
  const defaultBase = await readDefaultBase(ctx.session.repoHost, ctx.session.root);
  const deployed = await readDeployedCommit(ctx, ctx.run);

  const treeFacts = await readChangeFacts(ctx.session.repoHost, {
    ...buildChangeFactsRequest(ctx.wringer, ctx.session.root, defaultBase),
    deployed,
  });

  const treeFingerprint = treeFacts.featureFingerprints.get(feature);

  invariant(treeFingerprint !== undefined, `The change facts hold no fingerprint of ${feature}.`);

  if (ctx.target.mode === 'launch' && ctx.run.scopesRead?.get(feature) !== treeFingerprint) {
    throw new WringerError('doctor-required', {
      message: `The files of ${feature} changed since this run started, or the run recorded none.`,
      hint: 'Run `up --restart` and `doctor`, then drive the feature again.',
    });
  }

  const pin: Pin =
    ctx.target.mode === 'launch'
      ? { kind: 'local' }
      : buildDeployedPin(ctx.wringer, {
          feature,
          deployed,
          deployedPaths: treeFacts.deployedPaths ?? [],
        });

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
    target: { name: ctx.targetName, evidence: ctx.target.evidence ?? 'local' },
    pin,
    evidence: drives.flatMap((envelope) => envelope.evidence),
  };
}

function readBase(ctx: BuiltinContext, givenBase: string | undefined): Promise<string> {
  if (givenBase !== undefined) {
    return Promise.resolve(givenBase);
  }

  return readDefaultBase(ctx.session.repoHost, ctx.session.root);
}

const upgradeHint = 'Upgrade wringer, then run `report` and `publish` again.';
const publishHint = 'Run `report` and `publish` again.';

async function checkGate(args: GateArgs, ctx: BuiltinContext): Promise<GateData> {
  const bodyPath = isAbsolute(args.bodyFile)
    ? args.bodyFile
    : join(ctx.session.root, args.bodyFile);

  const body = await ctx.session.repoHost.readText(bodyPath);

  const read = checkCommentRegistry(parseReportComment(body), ctx.wringer.name);

  const facts = await readCurrentFacts(ctx, args.base);

  const claims = read.ok ? read.comment.claims : [];

  const computed = buildReport({
    base: args.base,
    fingerprint: facts.fingerprint,
    features: ctx.wringer.features,
    featureFingerprints: facts.featureFingerprints,
    changedPaths: facts.changedPaths,
    shared: ctx.wringer.shared,
    ignore: ctx.wringer.ignore,
    verdicts: new Map(claims.map((claim) => [claim.feature, toVerdict(claim)] as const)),
    policy: ctx.wringer.gate,
  });

  // A body that holds no comment, or an unusable one, fails once; only a missing comment also
  // fails each changed feature.
  const bodyFailure = read.ok || read.reason === 'none' ? null : read;

  const failing = computed.features.flatMap((feature) => {
    const reason = pickFailureReason(feature, read, facts);

    return reason === null || bodyFailure !== null
      ? []
      : [{ name: feature.name, reason, status: feature.status }];
  });

  const known = new Set(ctx.wringer.features.map((feature) => feature.name));

  const data = {
    fingerprint: facts.fingerprint,
    failing,
    unmapped: computed.unmapped,
    unknownClaims: claims
      .filter((claim) => !known.has(claim.feature))
      .map((claim) => claim.feature),
  };

  if (bodyFailure !== null) {
    throw new WringerError('check-failed', {
      message: bodyFailure.message,
      hint: bodyFailure.reason === 'newer-version' ? upgradeHint : publishHint,
      data,
    });
  }

  if (failing.length > 0 || computed.unmapped.length > 0) {
    throw new WringerError('check-failed', {
      message: formatGateFailure(failing, computed.unmapped),
      hint: pickGateHint(failing, computed.unmapped),
      data,
    });
  }

  return data;
}

// A comment that another registry wrote says nothing about this one's features.
function checkCommentRegistry(read: CommentRead, registry: string): CommentRead {
  if (!read.ok || read.comment.registry === registry) {
    return read;
  }

  return {
    ok: false,
    reason: 'invalid',
    message: `The data comment is from ${read.comment.registry}; this CLI is ${registry}.`,
  };
}

function toVerdict(claim: Claim): Verdict {
  const { evidenceDigest: _digest, evidenceCount: _count, ...verdict } = claim;

  return { ...verdict, evidence: [] };
}

function pickFailureReason(
  feature: Report['features'][number],
  read: CommentRead,
  facts: ChangeFacts,
): string | null {
  if (feature.status === 'missing') {
    return read.ok ? 'no claim in the data comment' : read.message;
  }

  if (feature.status === 'stale') {
    return `verdict at ${feature.verdict?.featureFingerprint ?? ''}, tree at ${facts.featureFingerprints.get(feature.name) ?? ''}`;
  }

  if (feature.status === 'unpinned') {
    return 'the target reports no commit, and the registry refuses an unpinned verdict';
  }

  return null;
}

function formatGateFailure(
  failing: readonly { readonly name: string }[],
  unmapped: readonly string[],
): string {
  const lines = [
    failing.length > 0
      ? `${failing.length} changed feature(s) fail the gate: ${failing.map((feature) => feature.name).join(', ')}.`
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
