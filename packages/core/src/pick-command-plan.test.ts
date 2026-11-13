import { expect, test } from 'bun:test';
import { pickCommandPlan } from './pick-command-plan.ts';
import { buildMockRunView } from './test-utils/build-mock-run-view.ts';

test('it refuses a command that needs a run on a target with none', () => {
  const plan = pickCommandPlan({
    needsRun: true,
    needsDoctor: true,
    isRepoCommand: false,
    isFeatureCommand: false,
    run: undefined,
    targetName: 'local',
    mode: 'launch',
    fingerprintChanged: false,
    deadlinePassed: false,
  });

  expect(plan).toMatchObject({ kind: 'refuse', failure: { code: 'not-running' } });
});

test('it refuses a run whose tree changed since its doctor pass', () => {
  const plan = pickCommandPlan({
    needsRun: true,
    needsDoctor: true,
    isRepoCommand: false,
    isFeatureCommand: false,
    run: buildMockRunView({ doctor: 'passed' }),
    targetName: 'local',
    mode: 'launch',
    fingerprintChanged: true,
    deadlinePassed: false,
  });

  expect(plan).toMatchObject({ kind: 'refuse', failure: { code: 'doctor-required' } });
});

test('it refuses with a timeout a command whose deadline passed before its body', () => {
  const plan = pickCommandPlan({
    needsRun: false,
    needsDoctor: false,
    isRepoCommand: true,
    isFeatureCommand: false,
    run: undefined,
    targetName: 'local',
    mode: 'launch',
    fingerprintChanged: false,
    deadlinePassed: true,
  });

  expect(plan).toMatchObject({ kind: 'refuse', failure: { code: 'timeout' } });
});

test.each([
  {
    command: 'a command that needs the doctor, on a running run',
    facts: {
      needsRun: true,
      needsDoctor: true,
      isRepoCommand: false,
      isFeatureCommand: false,
      run: buildMockRunView({ doctor: 'passed' }),
    },
    plan: { kind: 'run', driveKind: 'run', drive: 'app' },
  },
  {
    command: 'a repo command with no run',
    facts: {
      needsRun: false,
      needsDoctor: false,
      isRepoCommand: true,
      isFeatureCommand: false,
      run: undefined,
    },
    plan: { kind: 'run', driveKind: 'runless', drive: 'none' },
  },
  {
    command: 'a built-in that needs no run',
    facts: {
      needsRun: false,
      needsDoctor: false,
      isRepoCommand: false,
      isFeatureCommand: false,
      run: undefined,
    },
    plan: { kind: 'run', driveKind: 'none', drive: 'none' },
  },
  {
    command: 'a built-in that needs no run and the current feature names',
    facts: {
      needsRun: false,
      needsDoctor: false,
      isRepoCommand: false,
      isFeatureCommand: true,
      run: undefined,
    },
    plan: { kind: 'run', driveKind: 'none', drive: 'feature-command' },
  },
] as const)('it plans a $plan.driveKind drive for $command', (row) => {
  const plan = pickCommandPlan({
    ...row.facts,
    targetName: 'local',
    mode: 'launch',
    fingerprintChanged: false,
    deadlinePassed: false,
  });

  expect(plan).toStrictEqual(row.plan);
});
