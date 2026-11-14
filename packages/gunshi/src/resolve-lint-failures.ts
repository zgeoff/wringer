import { buildFeatureFile, isGlobMatch, renderFeatureTable } from '@wringer/core';
import type { Wringer } from '@wringer/core';
import { z } from 'zod';
import { checkFeatureFile } from './lint-command/check-feature-file.ts';
import { collectDeadGlobs } from './lint-command/collect-dead-globs.ts';
import { collectJourneyCommands } from './lint-command/collect-journey-commands.ts';
import type { JourneyCommand, MarkdownFile } from './lint-command/collect-journey-commands.ts';
import { collectUnclaimedFiles } from './lint-command/collect-unclaimed-files.ts';
import {
  parseFeatureTableSpan,
  toComparableTable,
} from './lint-command/parse-feature-table-span.ts';
import { parseSkillMetadata } from './lint-command/parse-skill-metadata.ts';
import type { SkillMetadata } from './lint-command/parse-skill-metadata.ts';
import { resolveJourneyProblem } from './lint-command/resolve-journey-problem.ts';

export const lintFailureSchema = z.strictObject({
  // `where` names the feature, the glob group or the file that the check found at fault.
  check: z.enum([
    'paths',
    'unclaimed',
    'registry',
    'journey',
    'feature-file',
    'feature-table',
    'template',
  ]),
  where: z.string(),
  problem: z.string(),
});

type LintFailure = z.infer<typeof lintFailureSchema>;

export interface LintInput {
  readonly wringer: Wringer;

  // Every file of the repo that git tracks or does not ignore, relative to its root.
  readonly files: readonly string[];
  readonly skillPath: string;

  // The registry's own file, relative to the repo root, or null when it is unknown or lies outside
  // the repo.
  readonly registryFile: string | null;

  // The Markdown files of the verify skill's folder, its SKILL.md included when it exists.
  readonly skillFiles: readonly MarkdownFile[];
  readonly templateHash: string;
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

  const pathFailures = collectDeadGlobs(input.wringer, input.files).map((dead): LintFailure => ({
    check: 'paths',
    where: dead.where,
    problem: `The glob \`${dead.glob}\` matches no file.`,
  }));

  const unclaimedFailures = collectUnclaimedFiles(input.wringer, input.files).map(
    (file): LintFailure => ({
      check: 'unclaimed',
      where: file,
      problem:
        'No feature `paths`, shared or ignore glob matches the file. Add it to a feature, `.shared()` or `.ignore()`.',
    }),
  );

  const cliWords = metadata?.ok === true ? metadata.cliWords : null;

  return {
    commands: journeys.length,
    failures: [
      ...pathFailures,
      ...unclaimedFailures,
      ...collectRegistryFailures(input.wringer, input.registryFile),
      ...collectUploadFailures(input.wringer),
      ...journeyFailures.filter((failure) => failure !== null),
      ...collectFeatureFileFailures(input, cliWords),
      ...collectFeatureTableFailures(input, skill?.text ?? null, cliWords),
      ...collectTemplateFailures(metadata, input.skillPath, input.templateHash),
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

// The registry file must sit under a shared glob or a feature's `paths`, so a change to it makes
// the verdicts it can affect stale. An ignore glob does not count as cover.
function collectRegistryFailures(
  wringer: Wringer,
  registryFile: string | null,
): readonly LintFailure[] {
  if (registryFile === null) {
    return [];
  }

  const covered =
    isGlobMatch(registryFile, wringer.shared) ||
    wringer.features.some((feature) => isGlobMatch(registryFile, feature.paths));

  if (covered) {
    return [];
  }

  return [
    {
      check: 'registry',
      where: registryFile,
      problem:
        'No shared glob and no feature `paths` glob matches the registry file, so a change to it leaves every verdict standing. Add the file to `.shared()`.',
    },
  ];
}

// A target that uploads its evidence needs the hook that does it, or `publish` fails.
function collectUploadFailures(wringer: Wringer): readonly LintFailure[] {
  if (wringer.hooks.upload !== undefined) {
    return [];
  }

  return [...wringer.targets]
    .filter(([, target]) => target.evidence === 'upload')
    .map(([name]): LintFailure => ({
      check: 'registry',
      where: `target ${name}`,
      problem:
        "The target sets `evidence: 'upload'` and the registry has no `upload` hook. Add `.hook('upload', createHostUploader(…))`, or set `evidence: 'local'`.",
    }));
}

const featureFilePattern = /^references\/feature-(?<name>.+)\.md$/u;

// Each feature needs `references/feature-<name>.md` in the skill folder, each such file needs a
// feature, and each file needs the Journey and End state sections.
function collectFeatureFileFailures(
  input: LintInput,
  cliWords: readonly string[] | null,
): readonly LintFailure[] {
  const folder = input.skillPath.slice(0, input.skillPath.lastIndexOf('/') + 1);

  const names = new Set(input.wringer.features.map((feature) => feature.name));

  const missing = input.wringer.features.flatMap((feature): LintFailure[] => {
    const file = buildFeatureFile(feature.name);

    return input.skillFiles.some((candidate) => candidate.path === `${folder}${file}`)
      ? []
      : [
          {
            check: 'feature-file',
            where: `feature ${feature.name}`,
            problem: `The skill folder has no \`${file}\`. Write it with a Journey and an End state.`,
          },
        ];
  });

  const present = input.skillFiles.flatMap((file) => {
    const name = featureFilePattern.exec(file.path.slice(folder.length))?.groups?.['name'];

    return file.path.startsWith(folder) && name !== undefined ? [{ file, name }] : [];
  });

  const orphaned = present
    .filter((entry) => !names.has(entry.name))
    .map((entry): LintFailure => ({
      check: 'feature-file',
      where: `${entry.file.path}:1`,
      problem: `The registry has no feature named ${entry.name}. Remove the file, or register the feature.`,
    }));

  const misshapen = present
    .filter((entry) => names.has(entry.name))
    .flatMap((entry) =>
      checkFeatureFile(entry.file.text, entry.name, cliWords).map((found): LintFailure => ({
        check: 'feature-file',
        where: `${entry.file.path}:${found.line}`,
        problem: found.problem,
      })),
    );

  return [...missing, ...orphaned, ...misshapen];
}

function collectFeatureTableFailures(
  input: LintInput,
  skillText: string | null,
  cliWords: readonly string[] | null,
): readonly LintFailure[] {
  if (skillText === null) {
    return [];
  }

  const span = parseFeatureTableSpan(skillText);
  const command = `${[...(cliWords ?? [])].join(' ')} features --markdown`.trim();
  const hint = `Replace the span with the output of \`${command}\`.`;

  if (!span.ok) {
    return [
      {
        check: 'feature-table',
        where: `${input.skillPath}:${span.line}`,
        problem: `${span.reason} ${hint}`,
      },
    ];
  }

  if (
    toComparableTable(span.table) === toComparableTable(renderFeatureTable(input.wringer.features))
  ) {
    return [];
  }

  return [
    {
      check: 'feature-table',
      where: `${input.skillPath}:${span.line}`,
      problem: `The feature table differs from the registry's features. ${hint}`,
    },
  ];
}

function collectTemplateFailures(
  metadata: SkillMetadata | null,
  skillPath: string,
  templateHash: string,
): readonly LintFailure[] {
  if (metadata === null) {
    return [{ check: 'template', where: skillPath, problem: 'The verify skill is missing.' }];
  }

  if (!metadata.ok) {
    return [{ check: 'template', where: skillPath, problem: metadata.reason }];
  }

  if (metadata.template === templateHash) {
    return [];
  }

  const recorded =
    typeof metadata.template === 'number'
      ? `a template version number, ${metadata.template}`
      : `template ${metadata.template}`;

  return [
    {
      check: 'template',
      where: skillPath,
      problem: `The skill records ${recorded}, and the installed @wringer/gunshi ships template ${templateHash}. Run \`bun verify guide template\` for the template folder, bring the skill up to date with it, and set \`metadata.wringer-template\` to \`${templateHash}\`.`,
    },
  ];
}
