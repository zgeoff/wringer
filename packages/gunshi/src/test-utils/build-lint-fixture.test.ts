import { expect, test } from 'bun:test';
import { resolveLintFailures } from '../resolve-lint-failures.ts';
import { buildLintFixture } from './build-lint-fixture.ts';
import { createDemoWringer } from './create-demo-wringer.ts';

test('it builds inputs that pass lint when the SKILL.md text is valid', async () => {
  const wringer = createDemoWringer({ ignore: ['skill/**'] });

  const fixture = buildLintFixture(
    wringer,
    '---\nmetadata:\n  wringer-template: sha256:0a1b2c3d4e5f\n  wringer-command: bun verify\n---\n',
  );

  const result = await resolveLintFailures({
    wringer,
    ...fixture,
    registryFile: null,
    templateHash: 'sha256:0a1b2c3d4e5f',
  });

  expect(result).toStrictEqual({ commands: 1, failures: [] });
});
