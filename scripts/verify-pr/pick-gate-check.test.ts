import { expect, test } from 'bun:test';
import { pickGateCheck } from './pick-gate-check.ts';

test('it passes an ok envelope', () => {
  const stdout = JSON.stringify({ ok: true, data: { failing: [], unmapped: [] }, error: null });

  expect(pickGateCheck(stdout)).toStrictEqual({
    kind: 'verdict',
    result: { ok: true, detail: 'every changed feature has a verdict at the current fingerprint' },
  });
});

test('it names the failing features and the unmapped paths of a failed gate', () => {
  const stdout = JSON.stringify({
    ok: false,
    data: {
      failing: [{ name: 'core', reason: 'no verdict in the report' }],
      unmapped: ['a.txt'],
    },
    error: { code: 'check-failed', message: 'x' },
  });

  expect(pickGateCheck(stdout)).toStrictEqual({
    kind: 'verdict',
    result: {
      ok: false,
      detail: 'failing features: core (no verdict in the report); unmapped paths: a.txt',
    },
  });
});

test('it falls back to the error message when the envelope has no data', () => {
  const stdout = JSON.stringify({
    ok: false,
    data: null,
    error: { code: 'usage', message: 'bad flag' },
  });

  expect(pickGateCheck(stdout)).toStrictEqual({
    kind: 'verdict',
    result: { ok: false, detail: 'bad flag' },
  });
});

test('it gives no verdict for an envelope with an environment error', () => {
  const stdout = JSON.stringify({
    ok: false,
    data: null,
    error: { code: 'environment', message: 'git is not installed' },
  });

  expect(pickGateCheck(stdout)).toStrictEqual({
    kind: 'cannot-run',
    message: 'the gate could not run: git is not installed',
  });
});

test('it gives no verdict for text that is no envelope', () => {
  expect(pickGateCheck('boom')).toStrictEqual({
    kind: 'cannot-run',
    message: 'the gate printed no JSON envelope',
  });
});
