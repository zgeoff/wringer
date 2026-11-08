import { expect, test } from 'bun:test';
import { collectLintFiles } from './collect-lint-files.ts';

test('it lists each file once and drops a tracked file the working tree deleted', () => {
  const listing = {
    listed: 'src/kettle.ts\0src/kettle.ts\0src/gone.ts\0docs/verify/SKILL.md\0',
    deleted: 'src/gone.ts\0',
    skillFolder: 'docs/verify',
  };

  expect(collectLintFiles(listing)).toStrictEqual({
    files: ['src/kettle.ts', 'docs/verify/SKILL.md'],
    skillFolder: 'docs/verify',
    skillMarkdown: ['docs/verify/SKILL.md'],
  });
});

test.each([
  ['a trailing slash', 'docs/verify/'],
  ['a leading dot segment', './docs/verify'],
])('it finds the skill files under a skill folder written with %s', (_case, skillFolder) => {
  const listing = {
    listed: 'docs/verify/SKILL.md\0docs/verify/references/map.md\0docs/verify/notes.txt\0',
    deleted: '',
    skillFolder,
  };

  expect(collectLintFiles(listing)).toStrictEqual({
    files: ['docs/verify/SKILL.md', 'docs/verify/references/map.md', 'docs/verify/notes.txt'],
    skillFolder: 'docs/verify',
    skillMarkdown: ['docs/verify/SKILL.md', 'docs/verify/references/map.md'],
  });
});
