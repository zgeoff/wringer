import { z } from 'zod';
import { buildBuiltinCommand } from '../build-commands.ts';
import type { RegisteredCommand } from '../types.ts';
import { WringerError } from '../wringer-error.ts';

const execArgsSchema = z.strictObject({ argv: z.array(z.string()).min(1) });

const execDataSchema = z.strictObject({
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
});

// A raw exec could do anything, so it is always a write: a read-only target refuses it, and a repo
// that needs a read there declares a read-only action.
export function buildExecCommand(): RegisteredCommand {
  return buildBuiltinCommand({
    path: ['exec'],
    summary: "Run a command through the target's host, local or ssh",
    args: execArgsSchema,
    positionals: ['argv'],
    data: execDataSchema,
    effect: 'write',
    needsRun: true,
    needsDoctor: true,
    run: async (args, ctx) => {
      const drive = ctx.openDrive(ctx.target.access);

      const result = await drive.ctx.exec(args.argv);

      if (result.exitCode !== 0) {
        throw new WringerError('check-failed', {
          message: `${args.argv[0] ?? 'The command'} exited with code ${result.exitCode}.`,
          data: result,
        });
      }

      return result;
    },
  });
}
