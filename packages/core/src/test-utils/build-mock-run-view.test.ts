import { expect, test } from 'bun:test';
import { buildMockRunView } from './build-mock-run-view.ts';

test('it builds a running run whose doctor passed', () => {
  const view = buildMockRunView();

  expect({ status: view.status, doctor: view.doctor }).toStrictEqual({
    status: 'running',
    doctor: 'passed',
  });
});

test('it applies the overrides', () => {
  const view = buildMockRunView({ status: 'crashed', crashReason: 'the app exited' });

  expect({ status: view.status, crashReason: view.crashReason }).toStrictEqual({
    status: 'crashed',
    crashReason: 'the app exited',
  });
});
