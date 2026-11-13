import { realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { WringerError, buildBuiltinCommand } from '@wringer/core';
import type { BuiltinContext, RegisteredCommand } from '@wringer/core';
import { z } from 'zod';
import { collectLintFiles } from './collect-lint-files.ts';
import { lintFailureSchema, resolveLintFailures } from './resolve-lint-failures.ts';
import { templateVersion } from './template-version.ts';

const lintArgsSchema = z.strictObject({});

type LintArgs = z.infer<typeof lintArgsSchema>;

const lintDataSchema = z.strictObject({
  skill: z.string(),
  commands: z.number().int().nonnegative(),
  failures: z.array(lintFailureSchema),
});

type LintData = z.infer<typeof lintDataSchema>;

// `lint` needs no run, so CI can call it on a fresh checkout.
export function buildLintCommand(
  skillFolder: string,
  registryFile: string | null,
): RegisteredCommand {
  return buildBuiltinCommand<LintArgs, LintData>({
    path: ['lint'],
    summary: 'Check the feature paths and the verify skill against the CLI, with no running app',
    args: lintArgsSchema,
    data: lintDataSchema,
    effect: 'read',
    needsRun: false,
    needsDoctor: false,
    run: (_args, ctx) => runLint(ctx, skillFolder, registryFile),
  });
}

async function runLint(
  ctx: BuiltinContext,
  skillFolder: string,
  registryFile: string | null,
): Promise<LintData> {
  const root = ctx.session.root;

  const [listed, deleted] = await Promise.all([
    ctx.session.repoHost.runGit({
      cwd: root,
      args: ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    }),
    ctx.session.repoHost.runGit({ cwd: root, args: ['ls-files', '-z', '--deleted'] }),
  ]);

  const lintFiles = collectLintFiles({
    listed: listed.stdout,
    deleted: deleted.stdout,
    skillFolder,
  });

  const skillFiles = await Promise.all(
    lintFiles.skillMarkdown.map(async (path) => ({
      path,
      text: await ctx.session.repoHost.readText(join(root, path)),
    })),
  );

  const skillPath = `${lintFiles.skillFolder}/SKILL.md`;

  const result = await resolveLintFailures({
    wringer: ctx.wringer,
    files: lintFiles.files,
    skillPath,
    registryFile: await resolveRegistryFile(root, registryFile),
    skillFiles,
    templateVersion,
  });

  const data = { skill: skillPath, commands: result.commands, failures: [...result.failures] };
  const error = buildLintError(data);

  if (error !== null) {
    throw error;
  }

  return data;
}

// The registry file as a path from the repo root, or null when it is unknown or outside the repo.
// Both sides go through `realpath`, so a symlinked checkout still compares equal.
async function resolveRegistryFile(root: string, file: string | null): Promise<string | null> {
  if (file === null) {
    return null;
  }

  const [realRoot, realFile] = await Promise.all([
    realpath(root).catch(() => root),
    realpath(resolve(root, file)).catch(() => resolve(root, file)),
  ]);

  const path = relative(realRoot, realFile).split('\\').join('/');

  return path === '..' || path.startsWith('../') || isAbsolute(path) ? null : path;
}

function buildLintError(data: LintData): WringerError | null {
  if (data.failures.length === 0) {
    return null;
  }

  const listedFailures = data.failures.map((failure) => `${failure.where}: ${failure.problem}`);

  return new WringerError('check-failed', {
    message: `${data.failures.length} lint failure(s). ${listedFailures.join(' ')}`,
    hint: 'Fix each failure in the feature map or the verify skill, then run `lint` again.',
    data,
  });
}
