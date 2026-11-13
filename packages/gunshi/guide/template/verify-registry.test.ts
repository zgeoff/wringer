import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { resolveLintFailures } from '../../src/resolve-lint-failures.ts';
import { templateVersion } from '../../src/template-version.ts';
import { createVerifyRegistry } from './verify-registry.ts';

test('it pairs with a verify skill whose journeys parse and whose template version is current', async () => {
  const skillPath = '.claude/skills/verify/SKILL.md';
  const mapPath = '.claude/skills/verify/references/feature-map.md';

  const [skill, map] = await Promise.all([
    Bun.file(join(import.meta.dir, 'verify', 'SKILL.md')).text(),
    Bun.file(join(import.meta.dir, 'verify', 'references', 'feature-map.md')).text(),
  ]);

  const result = await resolveLintFailures({
    wringer: createVerifyRegistry(),
    files: ['src/items/add-item.ts', 'src/pages/pantry/pantry.tsx', skillPath, mapPath],
    skillPath,
    registryFile: 'scripts/verify/verify-registry.ts',
    skillFiles: [
      { path: skillPath, text: skill },
      { path: mapPath, text: map },
    ],
    templateVersion,
  });

  expect(result).toStrictEqual({ commands: 4, failures: [] });
});
