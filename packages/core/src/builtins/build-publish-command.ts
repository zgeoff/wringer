import { z } from 'zod';
import { collectUploadItems } from '../evidence/collect-upload-items.ts';
import type { EvidenceUploader } from '../evidence/evidence-uploader.ts';
import type { UploadRefusal } from '../evidence/pick-upload-refusal.ts';
import { uploadEvidence } from '../evidence/upload-evidence.ts';
import { buildBuiltinCommand } from '../registry/build-builtin-command.ts';
import { pickPullRequest } from '../repo-host/pick-pull-request.ts';
import { buildFileKey, buildLinkedDocument } from '../report-document/build-linked-document.ts';
import { buildLocalDocument } from '../report-document/build-local-document.ts';
import { buildRefusedDocument } from '../report-document/build-refused-document.ts';
import { readReportDocument } from '../report-document/read-report-document.ts';
import type { ReportDocument } from '../report-document/report-document.ts';
import { maxDescriptionChars, resolveSpanBudget } from '../report-document/resolve-span-budget.ts';
import { writeReportSpan } from '../report-document/write-report-span.ts';
import { collectShownEntries } from '../report-plan/collect-shown-files.ts';
import { planReport } from '../report-plan/plan-report.ts';
import { reportCutsSchema } from '../report-plan/report-plan.ts';
import type { ReportPlan } from '../report-plan/report-plan.ts';
import { renderReport } from '../report/render-report.ts';
import { readRunSecrets } from '../secrets/read-run-secrets.ts';
import { runIDSchema } from '../state/run-event.ts';
import type {
  BuiltinCommandSpec,
  BuiltinContext,
  PullRequestView,
  RegisteredCommand,
} from '../types.ts';
import { maxBaseLength } from '../verdict/report-schema.ts';
import { WringerError } from '../wringer-error.ts';
import { readCurrentReport } from './read-current-report.ts';

const publishArgsSchema = z.strictObject({
  base: z.string().min(1).max(maxBaseLength).optional(),
  pr: z.number().int().positive().optional(),
  dryRun: z.boolean().default(false),
  upload: z.boolean().default(true),
});

type PublishArgs = z.infer<typeof publishArgsSchema>;

const publishDataSchema = z.strictObject({
  pr: z.strictObject({ number: z.number().int(), url: z.string() }),
  action: z.enum(['created', 'replaced', 'unchanged']),
  uploaded: z.number().int().nonnegative(),
  reused: z.number().int().nonnegative(),
  local: z.number().int().nonnegative(),
  cuts: reportCutsSchema,
  dryRun: z.boolean(),
  markdown: z.string().optional(),
});

type PublishData = z.infer<typeof publishDataSchema>;

const publishTimeoutMs = 300_000;

// `publish` is the one command that uploads evidence and writes the PR description. It writes to
// the PR and the file host and never to the target, so it needs no run and runs on a read-only
// target.
export function buildPublishCommand(): RegisteredCommand {
  const publish: BuiltinCommandSpec<PublishArgs, PublishData> = {
    path: ['publish'],
    summary: 'Write the report into the PR description, with its evidence uploaded',
    args: publishArgsSchema,
    data: publishDataSchema,
    effect: 'write',
    touchesTarget: false,
    needsRun: false,
    needsDoctor: false,
    timeoutMs: publishTimeoutMs,
    run: (args, ctx) => runPublish(args, ctx),
  };

  return buildBuiltinCommand(publish);
}

async function runPublish(args: PublishArgs, ctx: BuiltinContext): Promise<PublishData> {
  const setup = readUploadSetup(args, ctx);

  const pr = await readPullRequest(args, ctx);
  const base = await readBase(args, pr, ctx);
  const report = await readCurrentReport(ctx, base);

  await readVerdictSecrets(
    ctx,
    report.features.flatMap((feature) => feature.verdict?.run ?? []),
  );

  const linkHosts = setup.uploader !== undefined && !args.dryRun ? setup.uploader.linkHosts : [];

  const document = await readReportDocument(
    {
      wringer: ctx.wringer,
      state: ctx.state,
      files: ctx.session.repoHost,
      root: ctx.session.root,
      stateDir: ctx.stateDir,
      secrets: ctx.secrets,
    },
    report,
    { isUploadAllowed: setup.isAllowed, linkHosts },
  );

  failOnSecretFile(document);

  if (args.dryRun) {
    return runDryRun(document, pr, ctx);
  }

  const linkChars = setup.uploader === undefined ? 0 : setup.uploader.maxURLLength;
  const first = planAgainst({ document, body: pr.body, linkChars }, ctx);

  const uploads =
    setup.uploader === undefined
      ? { document, links: new Map<string, string>(), uploaded: 0, reused: 0 }
      : await uploadPlanned(
          { document, first, linkChars, uploader: setup.uploader, body: pr.body },
          ctx,
        );

  // Another writer may have edited the description during the uploads, so the block goes into the
  // description as it stands now. A description that shrank gets no larger a budget, so the plan
  // shows no file the uploads left out.
  const current = await ctx.session.pullRequests.readBody(pr.number);

  const linked = buildLinkedDocument(uploads.document, uploads.links);

  const written = writeBlock(
    { document: linked, body: current.body, linkChars, maxChars: first.budgetChars },
    ctx,
  );

  const shown = collectShownEntries(linked, written.plan);

  const localFiles = new Set(
    shown
      .filter((entry) => entry.file.url === null)
      .map((entry) => buildFileKey(entry.file.evidence)),
  );

  if (written.action !== 'unchanged') {
    if (ctx.signal.aborted) {
      throw new WringerError('timeout');
    }

    assertBodyClean(written.body, ctx);

    await ctx.session.pullRequests.writeBody(pr.number, written.body);
  }

  await confirmWrite(pr.number, written.block, ctx);

  return {
    pr: { number: pr.number, url: pr.url },
    action: written.action,
    uploaded: uploads.uploaded,
    reused: uploads.reused,
    local: localFiles.size,
    cuts: written.plan.cuts,
    dryRun: false,
  };
}

interface UploadSetup {
  // The uploader when this publish sends files, else undefined.
  readonly uploader: EvidenceUploader | undefined;

  // Whether a journey on an uploading target may upload.
  readonly isAllowed: boolean;
}

// A registry whose target uploads needs the hook, and the hook needs its configuration, before the
// command reads the PR or any file.
function readUploadSetup(args: PublishArgs, ctx: BuiltinContext): UploadSetup {
  const targetsUpload = [...ctx.wringer.targets.values()].some(
    (target) => target.evidence === 'upload',
  );

  if (!args.upload || !targetsUpload) {
    return { uploader: undefined, isAllowed: false };
  }

  const uploader = ctx.wringer.hooks.upload;

  if (uploader === undefined) {
    throw new WringerError('usage', {
      message: 'A target of the registry uploads evidence, and the registry has no upload hook.',
      hint: "Add an `upload` hook with `.hook('upload', …)`, or pass `--no-upload`.",
    });
  }

  if (!args.dryRun) {
    uploader.assertReady?.();
  }

  for (const secret of uploader.readSecrets?.() ?? []) {
    ctx.secrets.add(secret);
  }

  return { uploader, isAllowed: true };
}

async function readPullRequest(args: PublishArgs, ctx: BuiltinContext): Promise<PullRequestView> {
  const request = args.pr === undefined ? { branch: await readBranch(ctx) } : { number: args.pr };

  const found = await ctx.session.pullRequests.findOpen(request);

  const picked = pickPullRequest(found, args.pr !== undefined);

  if (!picked.ok) {
    throw picked.failure;
  }

  return picked.pr;
}

async function readBranch(ctx: BuiltinContext): Promise<string> {
  try {
    const result = await ctx.session.repoHost.runGit({
      cwd: ctx.session.root,
      args: ['symbolic-ref', '--quiet', '--short', 'HEAD'],
    });

    const branch = result.stdout.trim();

    if (branch !== '') {
      return branch;
    }
  } catch {
    // A detached HEAD makes git exit non-zero, which is the answer.
  }

  throw new WringerError('environment', {
    message: 'HEAD is detached, so there is no current branch to find a pull request for.',
    hint: 'Pass `--pr <number>`.',
  });
}

// The base is the PR's own, as `origin/<base>` when the clone has that branch, else `<base>`.
async function readBase(
  args: PublishArgs,
  pr: PullRequestView,
  ctx: BuiltinContext,
): Promise<string> {
  if (args.base !== undefined) {
    return args.base;
  }

  if (pr.baseBranch.length === 0 || pr.baseBranch.length > maxBaseLength - 'origin/'.length) {
    throw new WringerError('environment', {
      message: 'The pull request names a base branch that is empty or too long.',
      hint: 'Pass `--base <ref>`.',
    });
  }

  try {
    await ctx.session.repoHost.runGit({
      cwd: ctx.session.root,
      args: ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${pr.baseBranch}`],
    });

    return `origin/${pr.baseBranch}`;
  } catch {
    return pr.baseBranch;
  }
}

async function readVerdictSecrets(ctx: BuiltinContext, runs: readonly string[]): Promise<void> {
  for (const run of new Set(runs)) {
    const runID = runIDSchema.safeParse(run);

    if (runID.success) {
      await readRunSecrets(ctx.state, ctx.secrets, runID.data);
    }
  }
}

// A file that holds a known secret means the scrubber missed it, and step data may hold it too.
function failOnSecretFile(document: ReportDocument): void {
  for (const journey of document.journeys.values()) {
    const leaking = journey.steps
      .flatMap((step) => step.files)
      .find((file) => file.refusal === 'secret-found');

    if (journey.evidence === 'upload' && leaking !== undefined) {
      throw new WringerError('internal', {
        message: `The file ${leaking.evidence.path} holds a known secret, so nothing was uploaded or written.`,
        hint: 'The scrubber missed it. Remove the run folder, and report the bug.',
      });
    }
  }
}

// Prints the block with local evidence, and counts the files a real run would upload.
function runDryRun(
  document: ReportDocument,
  pr: PullRequestView,
  ctx: BuiltinContext,
): PublishData {
  const local = buildLocalDocument(document);
  const planned = planAgainst({ document: local, body: pr.body, linkChars: 0 }, ctx);
  const block = renderBlock(local, planned.plan, ctx);
  const edit = writeReportSpan(pr.body, block);

  if (!edit.ok) {
    throw new WringerError('check-failed', { message: edit.reason });
  }

  // The files the shown cells would link: sized against a host, so the guard's verdict decides.
  const wouldUpload = new Set(
    collectUploadItems({ ...document, linkHosts: ['dry-run'] }, planned.plan, 1).map((item) =>
      buildFileKey(item.evidence),
    ),
  );

  const shown = new Set(
    collectShownEntries(local, planned.plan).map((entry) => buildFileKey(entry.file.evidence)),
  );

  return {
    pr: { number: pr.number, url: pr.url },
    action: edit.action,
    uploaded: wouldUpload.size,
    reused: 0,
    local: shown.size - wouldUpload.size,
    cuts: planned.plan.cuts,
    dryRun: true,
    markdown: block,
  };
}

interface PlanRequest {
  readonly document: ReportDocument;
  readonly body: string;
  readonly linkChars: number;

  // A budget the plan may not exceed, such as the first plan's.
  readonly maxChars?: number | undefined;
}

interface PlannedSpan {
  readonly plan: ReportPlan;
  readonly budgetChars: number;
}

// Plans the document into the span the description leaves, or fails with the room it lacks.
function planAgainst(request: PlanRequest, ctx: BuiltinContext): PlannedSpan {
  const budget = resolveSpanBudget(request.body);

  if (!budget.ok) {
    throw new WringerError('check-failed', {
      message: budget.reason,
      hint: 'Fix the markers in the pull request description, then run `publish` again.',
    });
  }

  const budgetChars = Math.min(budget.budgetChars, request.maxChars ?? budget.budgetChars);

  const result = planReport(
    request.document,
    { budgetChars, linkChars: request.linkChars },
    ctx.secrets,
  );

  if (!result.ok) {
    throw new WringerError('check-failed', {
      message: `The report needs ${formatCount(result.minimumChars)} characters, and the PR description has room for ${formatCount(budgetChars)} of GitHub's ${formatCount(maxDescriptionChars)}.`,
      hint: 'Shorten the description outside the report, or verify fewer features in this PR.',
    });
  }

  return { plan: result.plan, budgetChars };
}

function formatCount(count: number): string {
  return count.toLocaleString('en-US');
}

// The rendered block never carries a known secret: the renderer scrubs each value, and this is the
// backstop.
function renderBlock(document: ReportDocument, plan: ReportPlan, ctx: BuiltinContext): string {
  const block = renderReport(document, plan, ctx.secrets);

  if (ctx.secrets.findSecret(block) !== null) {
    throw new WringerError('internal', {
      message: 'The report holds a known secret, so it was not written.',
      hint: 'The scrubber missed it. Report the bug.',
    });
  }

  return block;
}

interface UploadRequest {
  readonly document: ReportDocument;
  readonly first: PlannedSpan;
  readonly linkChars: number;
  readonly uploader: EvidenceUploader;
  readonly body: string;
}

interface UploadResult {
  // The document with every refusal the upload guard gave.
  readonly document: ReportDocument;
  readonly links: ReadonlyMap<string, string>;
  readonly uploaded: number;
  readonly reused: number;
}

// Uploads the files the plan shows as links. The upload guard may refuse a file the document guard
// let through, such as one that changed in between. Such a file stays local, so the document takes
// the refusal and the plan is made again, until every file the plan sizes as a link has its link.
async function uploadPlanned(request: UploadRequest, ctx: BuiltinContext): Promise<UploadResult> {
  const links = new Map<string, string>();
  const refusals = new Map<string, UploadRefusal['reason']>();

  const counts = { uploaded: 0, reused: 0 };
  let document = request.document;
  let plan = request.first.plan;

  for (;;) {
    const items = collectUploadItems(document, plan, request.linkChars).filter((item) => {
      const key = buildFileKey(item.evidence);

      return !links.has(key) && !refusals.has(key);
    });

    if (items.length === 0) {
      break;
    }

    const outcomes = await uploadEvidence(items, {
      uploader: request.uploader,
      state: ctx.state,
      files: ctx.session.repoHost,
      root: ctx.session.root,
      stateDir: ctx.stateDir,
      secrets: ctx.secrets,
      now: ctx.now,
      signal: ctx.signal,
    });

    let refusedCount = 0;

    for (const [index, outcome] of outcomes.entries()) {
      const evidence = items[index]?.evidence;

      if (evidence === undefined) {
        continue;
      }

      const key = buildFileKey(evidence);

      if (outcome.kind === 'local') {
        refusals.set(key, outcome.refusal.reason);

        refusedCount += 1;
      } else if (!links.has(key)) {
        links.set(key, outcome.link.url);

        counts[outcome.isReused ? 'reused' : 'uploaded'] += 1;
      }
    }

    if (refusedCount === 0) {
      break;
    }

    document = buildRefusedDocument(request.document, refusals);

    plan = planAgainst(
      {
        document,
        body: request.body,
        linkChars: request.linkChars,
        maxChars: request.first.budgetChars,
      },
      ctx,
    ).plan;
  }

  return { document, links, ...counts };
}

interface BlockRequest {
  readonly document: ReportDocument;
  readonly body: string;
  readonly linkChars: number;
  readonly maxChars: number;
}

interface WrittenBlock {
  readonly plan: ReportPlan;
  readonly block: string;
  readonly body: string;
  readonly action: 'created' | 'replaced' | 'unchanged';
}

const maxFitAttempts = 5;

// Plans, renders and places the block. A description with CRLF line endings grows by one character
// per line of the block, so a body still over the limit shrinks the budget by the overflow and
// plans again.
function writeBlock(request: BlockRequest, ctx: BuiltinContext): WrittenBlock {
  let maxChars = request.maxChars;

  for (let attempt = 0; attempt < maxFitAttempts; attempt += 1) {
    const planned = planAgainst({ ...request, maxChars }, ctx);
    const block = renderBlock(request.document, planned.plan, ctx);
    const edit = writeReportSpan(request.body, block);

    if (!edit.ok) {
      throw new WringerError('check-failed', {
        message: edit.reason,
        hint: 'Fix the pull request description, then run `publish` again.',
      });
    }

    const overflow = edit.body.length - maxDescriptionChars;

    if (overflow <= 0) {
      return { plan: planned.plan, block, body: edit.body, action: edit.action };
    }

    maxChars = planned.budgetChars - overflow;
  }

  throw new WringerError('internal', {
    message: 'The report did not fit the description after several plans.',
  });
}

// The whole description, the author's text included, never goes to the host holding a known secret.
function assertBodyClean(body: string, ctx: BuiltinContext): void {
  if (ctx.secrets.findSecret(body) !== null) {
    throw new WringerError('check-failed', {
      message: 'The pull request description holds a known secret, so it was not written.',
      hint: 'Remove the secret from the description outside the report, then run `publish` again.',
    });
  }
}

// Reads the description once more, and fails when it no longer holds the block that was written.
async function confirmWrite(number: number, block: string, ctx: BuiltinContext): Promise<void> {
  const confirmed = await ctx.session.pullRequests.readBody(number);

  const check = writeReportSpan(confirmed.body, block);

  if (check.ok && check.action === 'unchanged') {
    return;
  }

  throw new WringerError('check-failed', {
    message:
      'The report block is gone from the pull request description: another writer replaced it after the write, and that span stands.',
    hint: 'Run `publish` again.',
  });
}
