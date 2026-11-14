import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { readTemplateHash } from '../../src/lint-command/read-template-hash.ts';
import { resolveLintFailures } from '../../src/resolve-lint-failures.ts';
import { createVerifyRegistry } from './create-verify-registry.ts';

test('it pairs with a verify skill whose journeys parse and whose template hash is current', async () => {
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
    registryFile: 'scripts/verify/create-verify-registry.ts',
    skillFiles: [
      { path: skillPath, text: skill },
      { path: featurePath, text: feature },
    ],
    templateHash: await readTemplateHash(),
  });

  expect(result).toStrictEqual({ commands: 5, failures: [] });
});
