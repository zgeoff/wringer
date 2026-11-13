import { expect, test } from 'bun:test';
import { findSkillCopyRefusal } from './find-skill-copy-refusal.ts';

test.each([
  { destination: '/repo/.claude/skills/wringer', state: 'absent' },
  { destination: '/repo/.claude/skills/wringer', state: 'wringer-skill' },
  { destination: '/repo/tools/wringer', state: 'absent' },
] as const)('it allows an install to $destination when it is $state', (row) => {
  expect(
    findSkillCopyRefusal({
      source: '/repo/node_modules/@wringer/gunshi/skills/wringer',
      destination: row.destination,
      cwd: '/repo',
      state: row.state,
    }),
  ).toBeNull();
});

test.each([
  { destination: '/repo', reason: 'holds the current folder' },
  { destination: '/', reason: 'holds the current folder' },
  { destination: '/repo/node_modules/@wringer/gunshi', reason: 'overlaps the packaged skill' },
  {
    destination: '/repo/node_modules/@wringer/gunshi/skills/wringer',
    reason: 'overlaps the packaged skill',
  },
  {
    destination: '/repo/node_modules/@wringer/gunshi/skills/wringer/template',
    reason: 'overlaps the packaged skill',
  },
])('it refuses an install to $destination because it $reason', (row) => {
  expect(
    findSkillCopyRefusal({
      source: '/repo/node_modules/@wringer/gunshi/skills/wringer',
      destination: row.destination,
      cwd: '/repo',
      state: 'absent',
    }),
  ).toContain(row.reason);
});

test('it refuses to replace a folder that is not a copy of the wringer skill', () => {
  expect(
    findSkillCopyRefusal({
      source: '/repo/node_modules/@wringer/gunshi/skills/wringer',
      destination: '/repo/.claude/skills',
      cwd: '/repo',
      state: 'other',
    }),
  ).toBe('/repo/.claude/skills exists and is not a copy of the wringer skill.');
});
