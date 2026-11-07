import type { Wringer } from '@wringer/core';
import { z } from 'zod';
import { collectDeadGlobs } from './collect-dead-globs.ts';
import { collectJourneyCommands } from './collect-journey-commands.ts';
import type { JourneyCommand, MarkdownFile } from './collect-journey-commands.ts';
import { parseSkillMetadata } from './parse-skill-metadata.ts';
import type { SkillMetadata } from './parse-skill-metadata.ts';
import { resolveJourneyProblem } from './resolve-journey-problem.ts';

export const lintFailureSchema = z.strictObject({
  check: z.enum(['paths', 'journey', 'template']),
  where: z.string(),
  problem: z.string(),
});

export type LintFailure = z.infer<typeof lintFailureSchema>;

export interface LintInput {
  readonly wringer: Wringer;

  // Every file of the repo that git tracks or does not ignore, relative to its root.
  readonly files: readonly string[];
  readonly skillPath: string;

  // The Markdown files of the verify skill's folder, its SKILL.md included when it exists.
  readonly skillFiles: readonly MarkdownFile[];
  readonly templateVersion: number;
}

export interface LintResult {
  readonly commands: number;
  readonly failures: readonly LintFailure[];
}

// The lint failures of a repo: a `paths` glob that matches no file, a CLI line in the verify
// skill's code blocks that would fail to parse, and a skill that lacks the template version this
// package ships. It reads nothing; the CLI parser it calls is async but does no I/O.
export async function resolveLintFailures(input: LintInput): Promise<LintResult> {
  const skill = input.skillFiles.find((file) => file.path === input.skillPath);
  const metadata = skill === undefined ? null : parseSkillMetadata(skill.text);

  const journeys =
    metadata?.ok === true ? collectJourneyCommands(input.skillFiles, metadata.cliWords) : [];

  const journeyFailures = await Promise.all(
    journeys.map((journey) => resolveJourneyFailure(input.wringer, journey)),
  );

  const pathFailures = collectDeadGlobs(input.wringer.features, input.files).map(
    (dead): LintFailure => ({
      check: 'paths',
      where: `feature ${dead.feature}`,
      problem: `The glob \`${dead.glob}\` matches no file.`,
    }),
  );

  return {
    commands: journeys.length,
    failures: [
      ...pathFailures,
      ...journeyFailures.filter((failure) => failure !== null),
      ...collectTemplateFailures(metadata, input.skillPath, input.templateVersion),
    ],
  };
}

async function resolveJourneyFailure(
  wringer: Wringer,
  journey: JourneyCommand,
): Promise<LintFailure | null> {
  const problem =
    journey.argv === null
      ? 'The line has an unclosed quote.'
      : await resolveJourneyProblem(wringer, journey.argv);

  if (problem === null) {
    return null;
  }

  return {
    check: 'journey',
    where: `${journey.path}:${journey.line}`,
    problem: `\`${journey.text}\`: ${problem}`,
  };
}

function collectTemplateFailures(
  metadata: SkillMetadata | null,
  skillPath: string,
  templateVersion: number,
): readonly LintFailure[] {
  if (metadata === null) {
    return [{ check: 'template', where: skillPath, problem: 'The verify skill is missing.' }];
  }

  if (!metadata.ok) {
    return [{ check: 'template', where: skillPath, problem: metadata.reason }];
  }

  if (metadata.templateVersion === templateVersion) {
    return [];
  }

  return [
    {
      check: 'template',
      where: skillPath,
      problem: `The skill follows template ${metadata.templateVersion}, and the installed @wringer/gunshi ships template ${templateVersion}.`,
    },
  ];
}
