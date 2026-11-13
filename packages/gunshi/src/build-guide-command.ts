import { WringerError, buildBuiltinCommand } from '@wringer/core';
import type { RegisteredCommand } from '@wringer/core';
import { z } from 'zod';
import { guideDataSchema, pickGuideData } from './pick-guide-data.ts';
import type { GuideData } from './pick-guide-data.ts';
import { readGuide } from './read-guide.ts';

const guideArgsSchema = z.strictObject({
  topic: z.string().min(1).optional().describe('The topic to print; leave out to list the topics'),
});

type GuideArgs = z.infer<typeof guideArgsSchema>;

// `guide` needs no run and no repo CLI state: it prints the guide shipped in the installed package.
export function buildGuideCommand(): RegisteredCommand {
  return buildBuiltinCommand<GuideArgs, GuideData>({
    path: ['guide'],
    summary: 'Print the guide for adding a verify CLI to a repo, or one of its topics',
    args: guideArgsSchema,
    positionals: ['topic'],
    data: guideDataSchema,
    effect: 'read',
    needsRun: false,
    needsDoctor: false,
    run: async (args) => {
      const guide = await readGuide();

      const data = pickGuideData(guide, args.topic);

      if (data instanceof WringerError) {
        throw data;
      }

      return data;
    },
  });
}
