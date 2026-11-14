import { buildFeatureFile, renderFeatureTable } from '@wringer/core';
import type { Wringer } from '@wringer/core';
import type { MarkdownFile } from '../lint-command/collect-journey-commands.ts';

export interface LintFixture {
  readonly files: readonly string[];
  readonly skillPath: string;
  readonly skillFiles: readonly MarkdownFile[];
}

// The inputs of `resolveLintFailures` for a skill in `skill/` that is valid but for the SKILL.md
// text the test gives: SKILL.md followed by the wringer's feature table, a valid file for each
// feature, and the extra files, with every listed file under `src/` or the skill folder.
export function buildLintFixture(
  wringer: Wringer,
  skillText: string,
  extraFiles: readonly MarkdownFile[] = [],
  folder = 'skill',
): LintFixture {
  const skillFiles: readonly MarkdownFile[] = [
    {
      path: `${folder}/SKILL.md`,
      text: `${skillText}\n<!-- wringer:features -->\n${renderFeatureTable(wringer.features)}\n<!-- /wringer:features -->\n`,
    },
    ...wringer.features.map((feature) => ({
      path: `${folder}/${buildFeatureFile(feature.name)}`,
      text: [
        `# ${feature.name}`,
        '',
        '## Journey',
        '',
        '```bash',
        `bun verify use --feature ${feature.name}`,
        '```',
        '',
        '## End state',
        '',
        '- It works.',
        '',
      ].join('\n'),
    })),
    ...extraFiles,
  ];

  return {
    files: ['src/greet.ts', 'src/cart.ts', ...skillFiles.map((file) => file.path)],
    skillPath: `${folder}/SKILL.md`,
    skillFiles,
  };
}
