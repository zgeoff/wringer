import { expect, test } from 'bun:test';
import { parseSkillInstallArgs } from './parse-skill-install-args.ts';

test('it defaults the destination to the wringer skill folder under .claude', () => {
  expect(parseSkillInstallArgs(['skill', 'install'])).toStrictEqual({
    destination: '.claude/skills/wringer',
  });
});

test('it takes the destination from --dir', () => {
  expect(parseSkillInstallArgs(['skill', 'install', '--dir', 'tools/wringer'])).toStrictEqual({
    destination: 'tools/wringer',
  });
});

test.each([
  ['no command', []],
  ['an unknown command', ['skill', 'remove']],
  ['an unknown flag', ['skill', 'install', '--force']],
  ['a missing --dir value', ['skill', 'install', '--dir']],
  ['an extra argument', ['skill', 'install', 'extra']],
])('it answers null for %s', (_case, argv) => {
  expect(parseSkillInstallArgs(argv)).toBeNull();
});
