import { expect, test } from 'bun:test';
import { WringerError } from '../wringer-error.ts';
import { settleDispatchAnswer } from './settle-dispatch-answer.ts';

test('it answers a command that succeeded and was logged with its data and exit code 0', () => {
  const answer = settleDispatchAnswer(
    {
      command: 'notes.add',
      target: 'local',
      instance: 'mf3k2a-7q1z',
      feature: null,
      sha: 'a1b2c3d',
      durationMs: 12,
      data: { notes: 2 },
      evidence: [],
      cursors: {},
      truncatedPath: null,
      error: null,
    },
    null,
  );

  expect({
    ok: answer.envelope.ok,
    data: answer.envelope.data,
    exitCode: answer.exitCode,
  }).toStrictEqual({ ok: true, data: { notes: 2 }, exitCode: 0 });
});

test('it answers a command that failed and was logged with its own failure', () => {
  const answer = settleDispatchAnswer(
    {
      command: 'notes.add',
      target: 'local',
      instance: 'mf3k2a-7q1z',
      feature: null,
      sha: 'a1b2c3d',
      durationMs: 12,
      data: null,
      evidence: [],
      cursors: {},
      truncatedPath: null,
      error: new WringerError('timeout', { message: 'notes add ran past its deadline.' }),
    },
    null,
  );

  expect({ error: answer.envelope.error, exitCode: answer.exitCode }).toStrictEqual({
    error: { code: 'timeout', message: 'notes add ran past its deadline.', hint: null },
    exitCode: 5,
  });
});

test.each([
  { name: 'succeeded', error: null },
  { name: 'failed', error: new WringerError('timeout', { message: 'notes add timed out.' }) },
])('it answers a command that $name with the failed log write in place of its outcome', (row) => {
  const answer = settleDispatchAnswer(
    {
      command: 'notes.add',
      target: 'local',
      instance: 'mf3k2a-7q1z',
      feature: null,
      sha: 'a1b2c3d',
      durationMs: 12,
      data: { notes: 2 },
      evidence: [],
      cursors: {},
      truncatedPath: '.wringer/runs/mf3k2a-7q1z/payload.json',
      error: row.error,
    },
    new WringerError('environment', { message: 'The run log is full.' }),
  );

  expect({
    data: answer.envelope.data,
    truncated: answer.envelope.truncated,
    error: answer.envelope.error,
    exitCode: answer.exitCode,
  }).toStrictEqual({
    data: null,
    truncated: undefined,
    error: { code: 'environment', message: 'The run log is full.', hint: null },
    exitCode: 4,
  });
});
