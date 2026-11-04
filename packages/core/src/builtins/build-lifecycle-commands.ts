import { z } from 'zod';
import { buildBuiltinCommand } from '../build-commands.ts';
import type { BuiltinCommandSpec, RegisteredCommand } from '../types.ts';
import { WringerError } from '../wringer-error.ts';
import { runDataSchema, startRun } from './start-run.ts';
import type { RunData } from './start-run.ts';
import { stopDataSchema } from './stop-data-schema.ts';
import type { StopData } from './stop-data-schema.ts';
import { stopRun } from './stop-run.ts';

export const launchReadyTimeoutMs = 120_000;
const startArgsSchema = z.strictObject({ restart: z.boolean().default(false) });

type StartArgs = z.infer<typeof startArgsSchema>;

// `up` and `down` own a launch target's app; `attach` and `detach` never stop an attach target's
// app. None of them writes to the app, so all four run on a read-only target.
export function buildLifecycleCommands(): readonly RegisteredCommand[] {
  const up: BuiltinCommandSpec<StartArgs, RunData> = {
    path: ['up'],
    summary: 'Start a run of a launch target: its app, browser and stream recorders',
    args: startArgsSchema,
    data: runDataSchema,
    effect: 'read',
    needsRun: false,
    needsDoctor: false,
    timeoutMs: launchReadyTimeoutMs + 10_000,
    run: (args, ctx) => {
      if (ctx.target.mode !== 'launch') {
        throw new WringerError('usage', {
          message: `Target ${ctx.targetName} is an attach target.`,
          hint: `Run \`attach --target ${ctx.targetName}\`.`,
        });
      }

      return startRun(ctx, { restart: args.restart, readyTimeoutMs: launchReadyTimeoutMs });
    },
  };

  const attach: BuiltinCommandSpec<StartArgs, RunData> = {
    path: ['attach'],
    summary: "Start a run on an attach target's app, without owning the app",
    args: startArgsSchema,
    data: runDataSchema,
    effect: 'read',
    needsRun: false,
    needsDoctor: false,
    timeoutMs: launchReadyTimeoutMs + 10_000,
    run: (args, ctx) => {
      if (ctx.target.mode !== 'attach') {
        throw new WringerError('usage', {
          message: `Target ${ctx.targetName} is a launch target.`,
          hint: `Run \`up --target ${ctx.targetName}\`.`,
        });
      }

      return startRun(ctx, { restart: args.restart, readyTimeoutMs: launchReadyTimeoutMs });
    },
  };

  const down: BuiltinCommandSpec<Record<string, never>, StopData> = {
    path: ['down'],
    summary: "Stop the launch target's run and its app",
    args: z.strictObject({}),
    data: stopDataSchema,
    effect: 'read',
    needsRun: false,
    needsDoctor: false,
    run: (_args, ctx) => {
      if (ctx.target.mode !== 'launch') {
        throw new WringerError('usage', {
          message: `Target ${ctx.targetName} is an attach target.`,
          hint: `Run \`detach --target ${ctx.targetName}\`.`,
        });
      }

      return stopRun(ctx);
    },
  };

  const detach: BuiltinCommandSpec<Record<string, never>, StopData> = {
    path: ['detach'],
    summary: "End the attach target's run, leaving its app running",
    args: z.strictObject({}),
    data: stopDataSchema,
    effect: 'read',
    needsRun: false,
    needsDoctor: false,
    run: (_args, ctx) => {
      if (ctx.target.mode !== 'attach') {
        throw new WringerError('usage', {
          message: `Target ${ctx.targetName} is a launch target.`,
          hint: `Run \`down --target ${ctx.targetName}\`.`,
        });
      }

      return stopRun(ctx);
    },
  };

  return [
    buildBuiltinCommand(up),
    buildBuiltinCommand(attach),
    buildBuiltinCommand(down),
    buildBuiltinCommand(detach),
  ];
}
