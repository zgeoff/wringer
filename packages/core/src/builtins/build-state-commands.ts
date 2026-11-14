import { join, relative } from 'node:path';
import { z } from 'zod';
import { unassignedFeature } from '../dispatch/open-drive.ts';
import { findOwnValue } from '../find-own-value.ts';
import { buildBuiltinCommand } from '../registry/build-builtin-command.ts';
import { buildFeatureFile, renderFeatureTable } from '../report/render-feature-table.ts';
import { buildRunPaths } from '../state/build-state-paths.ts';
import type { BuiltinCommandSpec, RegisteredCommand } from '../types.ts';
import { WringerError } from '../wringer-error.ts';
import { buildUsePointers } from './build-use-pointers.ts';

const statusDataSchema = z.strictObject({
  target: z.string(),
  mode: z.enum(['launch', 'attach']),
  access: z.enum(['read-write', 'read-only']),
  instance: z.string().nullable(),
  status: z.enum(['none', 'starting', 'running', 'crashed', 'ended']),
  doctor: z.enum(['none', 'passed', 'failed']),
  feature: z.string().nullable(),
  evidence: z.string().nullable(),
  endpoints: z.record(z.string(), z.string()),
  services: z.array(z.string()),
  cursors: z.record(z.string(), z.number()),
});

type StatusData = z.infer<typeof statusDataSchema>;

const useArgsSchema = z.strictObject({
  feature: z.string().min(1).optional(),
  target: z.string().min(1).optional(),
});

type UseArgs = z.infer<typeof useArgsSchema>;

const useDataSchema = z.strictObject({
  target: z.string().nullable(),
  feature: z.string().nullable(),
  cursors: z.record(z.string(), z.number()),
});

type UseData = z.infer<typeof useDataSchema>;

const featureEntrySchema = z.strictObject({
  name: z.string(),
  summary: z.string(),
  paths: z.array(z.string()),
  file: z.string(),
});

const featuresArgsSchema = z.strictObject({ markdown: z.boolean().default(false) });

const featuresDataSchema = z.strictObject({
  features: z.array(featureEntrySchema),
  shared: z.array(z.string()),
  ignore: z.array(z.string()),
  markdown: z.string().optional(),
});

type FeaturesData = z.infer<typeof featuresDataSchema>;

// `status`, `use` and `features` read and set the worktree's own state, never the target's, so they
// run without a run and on a read-only target.
export function buildStateCommands(): readonly RegisteredCommand[] {
  const status: BuiltinCommandSpec<Record<string, never>, StatusData> = {
    path: ['status'],
    summary:
      'Show the target, its run, the doctor state, the feature, the evidence folder and cursors',
    args: z.strictObject({}),
    data: statusDataSchema,
    effect: 'read',
    needsRun: false,
    needsDoctor: false,
    run: async (_args, ctx) => {
      const paths = ctx.run === undefined ? undefined : buildRunPaths(ctx.stateDir, ctx.run.runID);

      return {
        target: ctx.targetName,
        mode: ctx.target.mode,
        access: ctx.target.access,
        instance: ctx.run?.runID ?? null,
        status: ctx.run?.status ?? 'none',
        doctor: ctx.run?.doctor ?? 'none',
        feature: ctx.feature,
        evidence:
          paths === undefined
            ? null
            : relative(ctx.session.root, join(paths.features, ctx.feature ?? unassignedFeature)),
        endpoints: ctx.run?.endpoints ?? {},
        services: [...(ctx.run?.services ?? [])],
        cursors: ctx.run === undefined ? {} : await ctx.state.readCursors(ctx.run.runID),
      };
    },
  };

  const use: BuiltinCommandSpec<UseArgs, UseData> = {
    path: ['use'],
    summary: 'Set the current feature or target for later commands',
    args: useArgsSchema,
    data: useDataSchema,
    effect: 'read',
    needsRun: false,
    needsDoctor: false,
    run: async (args, ctx) => {
      if (
        args.feature !== undefined &&
        !ctx.wringer.features.some((feature) => feature.name === args.feature)
      ) {
        throw new WringerError('usage', {
          message: `The feature map has no feature named ${args.feature}.`,
          hint: 'Run `features` to list them.',
        });
      }

      if (args.target !== undefined && !ctx.wringer.targets.has(args.target)) {
        throw new WringerError('usage', {
          message: `The repo has no target named ${args.target}.`,
        });
      }

      // The cursors belong to the target the pointers name after this command, which `--target`
      // may change.
      const before = await ctx.state.readPointers();

      const runID = findOwnValue(before.currentRun, args.target ?? ctx.targetName);
      const cursors = runID === undefined ? {} : await ctx.state.readCursors(runID);

      const pointers = await ctx.state.writePointers((current) =>
        buildUsePointers(current, {
          target: args.target,
          feature: args.feature,
          cursors,
          runID,
        }),
      );

      return { target: pointers.target ?? null, feature: pointers.feature ?? null, cursors };
    },
  };

  const features: BuiltinCommandSpec<z.infer<typeof featuresArgsSchema>, FeaturesData> = {
    path: ['features'],
    summary:
      "List the repo's feature map, with each feature's paths, and the paths that map to none",
    args: featuresArgsSchema,
    data: featuresDataSchema,
    effect: 'read',
    needsRun: false,
    needsDoctor: false,
    run: (args, ctx) => {
      const registered = ctx.wringer.features;

      const data = {
        features: registered.map((feature) => ({
          name: feature.name,
          summary: feature.summary,
          paths: [...feature.paths],
          file: buildFeatureFile(feature.name),
        })),
        shared: [...ctx.wringer.shared],
        ignore: [...ctx.wringer.ignore],
      };

      const result = args.markdown ? { ...data, markdown: renderFeatureTable(registered) } : data;

      return Promise.resolve(result);
    },
  };

  return [buildBuiltinCommand(status), buildBuiltinCommand(use), buildBuiltinCommand(features)];
}
