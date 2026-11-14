import { expect, test } from 'bun:test';
import { parseSkillMetadata } from './parse-skill-metadata.ts';

test('it reads the template hash and the CLI words from the frontmatter', () => {
  const text = [
    '---',
    'name: verify',
    'description: Drives the tea timer app.',
    'metadata:',
    '  wringer-template: sha256:0a1b2c3d4e5f',
    '  wringer-command: pnpm verify',
    '---',
    '',
    '# Verify the tea timer',
  ].join('\n');

  expect(parseSkillMetadata(text)).toStrictEqual({
    ok: true,
    template: 'sha256:0a1b2c3d4e5f',
    cliWords: ['pnpm', 'verify'],
  });
});

test.each([
  ['no frontmatter', '# Verify the tea timer\n', 'The skill has no YAML frontmatter.'],
  [
    'no template version',
    '---\nname: verify\nmetadata:\n  wringer-command: bun verify\n---\n',
    'The frontmatter lacks `metadata.wringer-template` as a hash or `metadata.wringer-command` as text.',
  ],
  [
    'frontmatter that is not YAML',
    '---\nmetadata: [unclosed\n---\n',
    'The frontmatter lacks `metadata.wringer-template` as a hash or `metadata.wringer-command` as text.',
  ],
  [
    'a command with an unclosed quote',
    `---\nmetadata:\n  wringer-template: sha256:0a1b2c3d4e5f\n  wringer-command: "bun 'verify"\n---\n`,
    '`metadata.wringer-command` is not a command line.',
  ],
])('it reports a skill with %s', (_case, text, reason) => {
  expect(parseSkillMetadata(text)).toStrictEqual({ ok: false, reason });
});
