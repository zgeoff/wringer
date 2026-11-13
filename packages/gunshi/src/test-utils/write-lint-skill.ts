import { dirname, join } from 'node:path';
import type { Wringer } from '@wringer/core';
import { buildLintFixture } from './build-lint-fixture.ts';

// Writes a verify skill into `docs/verify/` of a test repo: the SKILL.md text the test gives, the
// wringer's feature table, and a valid file for each feature.
export async function writeLintSkill(
  root: string,
  wringer: Wringer,
  skillText: string,
): Promise<void> {
  const fixture = buildLintFixture(wringer, skillText, [], 'docs/verify');

  await Promise.all(
    fixture.skillFiles.map(async (file) => {
      const path = join(root, file.path);

      await Bun.$`mkdir -p ${dirname(path)}`.quiet();
      await Bun.write(path, file.text);
    }),
  );
}
