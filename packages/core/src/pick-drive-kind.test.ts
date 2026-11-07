import { expect, test } from 'bun:test';
import { pickDriveKind } from './pick-drive-kind.ts';

test.each([
  { runStatus: 'running', needsRun: true, isRepoCommand: false, kind: 'run' },
  { runStatus: 'starting', needsRun: true, isRepoCommand: true, kind: 'run' },
  { runStatus: 'running', needsRun: false, isRepoCommand: true, kind: 'run' },
  { runStatus: 'starting', needsRun: false, isRepoCommand: true, kind: 'runless' },
  { runStatus: null, needsRun: false, isRepoCommand: true, kind: 'runless' },
  { runStatus: 'running', needsRun: false, isRepoCommand: false, kind: 'none' },
  { runStatus: null, needsRun: true, isRepoCommand: true, kind: 'none' },
] as const)(
  'it picks a $kind drive for a run $runStatus, needsRun $needsRun, repo command $isRepoCommand',
  (row) => {
    expect(pickDriveKind(row)).toBe(row.kind);
  },
);
