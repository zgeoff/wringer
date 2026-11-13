import type { RunView } from '../build-run-view.ts';
import { readRevision, revisionTimeoutMs } from '../read-revision.ts';
import { toWringerError } from '../to-wringer-error.ts';
import type { BuiltinContext, RevisionFunction } from '../types.ts';
import { WringerError } from '../wringer-error.ts';

// The deployed commit of an attach target that declares `revision`, or null for any other target,
// whose verdict stays unpinned. The doctor's read and the read now must name the same commit.
export async function readDeployedCommit(
  ctx: BuiltinContext,
  run: RunView,
): Promise<string | null> {
  const target = ctx.target;

  if (target.mode !== 'attach' || target.revision === undefined) {
    return null;
  }

  const recorded = run.revisionRead;

  if (recorded === null) {
    throw new WringerError('doctor-required', {
      message: `The doctor of run ${run.runID} read no revision of ${ctx.targetName}.`,
      hint: 'Run `doctor`, then drive the feature again.',
    });
  }

  const current = await readCurrentRevision(ctx, target.revision);

  return resolveDeployedCommit(ctx, recorded, current);
}

async function readCurrentRevision(
  ctx: BuiltinContext,
  revision: RevisionFunction,
): Promise<string> {
  const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(revisionTimeoutMs)]);
  const at = Math.min(ctx.deadlineAt, ctx.now().getTime() + revisionTimeoutMs);
  const drive = ctx.openDrive('read-only', { signal, at });

  try {
    return await readRevision(revision, drive.ctx);
  } catch (error) {
    const failure = toWringerError(error);

    throw new WringerError(failure.code, {
      message: `The revision of ${ctx.targetName} could not be read: ${failure.message}`,
      hint: 'Check the target, then run `done` again.',
    });
  }
}

// The revision the doctor read and the one read now may be two spellings of one commit, such as a
// prefix and the full id, so each resolves first.
async function resolveDeployedCommit(
  ctx: BuiltinContext,
  recorded: string,
  current: string,
): Promise<string> {
  if (recorded === current) {
    const commit = await readCommit(ctx, current);

    if (commit === null) {
      throw new WringerError('check-failed', {
        message: `The deployed revision ${current} is not a commit of this clone.`,
        hint: `Run \`git fetch origin ${current}\`, then run \`done\` again.`,
      });
    }

    return commit;
  }

  const [before, now] = await Promise.all([readCommit(ctx, recorded), readCommit(ctx, current)]);

  if (before === null || now === null || before !== now) {
    throw new WringerError('doctor-required', {
      message: `The revision of ${ctx.targetName} changed from ${recorded} to ${current} since the doctor.`,
      hint: 'Run `doctor`, then drive the feature again.',
    });
  }

  return now;
}

// A tag object, a tree, an ambiguous prefix and a commit the clone lacks all give null: the revision
// must name a commit as it stands, without peeling.
async function readCommit(ctx: BuiltinContext, revision: string): Promise<string | null> {
  const repoHost = ctx.session.repoHost;
  const root = ctx.session.root;

  try {
    const named = await repoHost.runGit({
      cwd: root,
      args: ['rev-parse', '--verify', '--end-of-options', revision],
    });

    const peeled = await repoHost.runGit({
      cwd: root,
      args: ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`],
    });

    return named.stdout.trim() === peeled.stdout.trim() ? peeled.stdout.trim() : null;
  } catch {
    return null;
  }
}
