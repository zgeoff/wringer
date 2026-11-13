import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { resolveLintFailures } from '../../src/resolve-lint-failures.ts';
import { templateVersion } from '../../src/template-version.ts';
import { createVerifyRegistry } from './verify-registry.ts';

test('it pairs with a verify skill whose journeys parse and whose template version is current', async () => {
  const skillPath = '.claude/skills/verify/SKILL.md';
  const featurePath = '.claude/skills/verify/references/feature-add-item.md';

  const [skill, feature] = await Promise.all([
    Bun.file(join(import.meta.dir, 'verify', 'SKILL.md')).text(),
    Bun.file(join(import.meta.dir, 'verify', 'references', 'feature-add-item.md')).text(),
  ]);

  const result = await resolveLintFailures({
    wringer: createVerifyRegistry(),
    files: [
      'src/items/add-item.ts',
      'src/pages/pantry/pantry.tsx',
      'scripts/verify/verify.ts',
      'docs/overview.md',
      'src/items/add-item.test.ts',
      '.github/workflows/ci.yml',
      skillPath,
      featurePath,
    ],
    skillPath,
    registryFile: 'scripts/verify/verify-registry.ts',
    skillFiles: [
      { path: skillPath, text: skill },
      { path: featurePath, text: feature },
    ],
    templateVersion,
  });

  expect(result).toStrictEqual({ commands: 5, failures: [] });
});
