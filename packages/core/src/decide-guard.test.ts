import { expect, test } from 'bun:test';
import { decideGuard } from './decide-guard.ts';
import { buildMockRunView } from './test-utils/build-mock-run-view.ts';

test('it lets a command that needs no run through without one', () => {
  const refusal = decideGuard({
    needsRun: false,
    needsDoctor: false,
    run: undefined,
    targetName: 'local',
    mode: 'launch',
    fingerprintChanged: false,
  });

  expect(refusal).toBeNull();
});

test('it names attach in the hint for an attach target with no run', () => {
  const refusal = decideGuard({
    needsRun: true,
    needsDoctor: true,
    run: undefined,
    targetName: 'prod',
    mode: 'attach',
    fingerprintChanged: false,
  });

  expect(refusal).toMatchObject({ code: 'not-running', hint: 'Run `attach --target prod` first.' });
});

test('it refuses a crashed run as not running', () => {
  const refusal = decideGuard({
    needsRun: true,
    needsDoctor: true,
    run: buildMockRunView({ status: 'crashed' }),
    targetName: 'local',
    mode: 'launch',
    fingerprintChanged: false,
  });

  expect(refusal).toMatchObject({ code: 'not-running' });
});

test('it refuses a run whose doctor failed', () => {
  const refusal = decideGuard({
    needsRun: true,
    needsDoctor: true,
    run: buildMockRunView({ doctor: 'failed' }),
    targetName: 'local',
    mode: 'launch',
    fingerprintChanged: false,
  });

  expect(refusal).toMatchObject({ code: 'doctor-required' });
});

test('it lets a drive through on a running run with a doctor pass', () => {
  const refusal = decideGuard({
    needsRun: true,
    needsDoctor: true,
    run: buildMockRunView(),
    targetName: 'local',
    mode: 'launch',
    fingerprintChanged: false,
  });

  expect(refusal).toBeNull();
});
