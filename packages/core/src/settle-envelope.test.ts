import { expect, test } from 'bun:test';
import { settleEnvelope } from './settle-envelope.ts';
import { WringerError } from './wringer-error.ts';

test('it builds the envelope input from the payload and what the cap left', () => {
  const input = settleEnvelope({
    command: 'notes.add',
    target: 'local',
    instance: 'mf3k2a-7q1z',
    feature: 'checkout',
    sha: 'a1b2c3d',
    durationMs: 12,
    driveEvidence: [{ kind: 'note', path: '.wringer/runs/a/note.txt', sha256: 'f'.repeat(64) }],
    payload: { data: { notes: 2 }, failure: null, cursors: { app: 120 } },
    capped: { data: { notes: 2 }, evidence: [], truncatedPath: null, failure: null },
  });

  expect(input).toStrictEqual({
    command: 'notes.add',
    target: 'local',
    instance: 'mf3k2a-7q1z',
    feature: 'checkout',
    sha: 'a1b2c3d',
    durationMs: 12,
    data: { notes: 2 },
    evidence: [{ kind: 'note', path: '.wringer/runs/a/note.txt', sha256: 'f'.repeat(64) }],
    cursors: { app: 120 },
    truncatedPath: null,
    error: null,
  });
});

test.each([
  {
    name: 'the payload’s failure ahead of the cap’s',
    payload: new WringerError('timeout'),
    cap: new WringerError('environment'),
    code: 'timeout',
  },
  {
    name: 'the cap’s failure after a command that worked',
    payload: null,
    cap: new WringerError('environment'),
    code: 'environment',
  },
  { name: 'no failure when both worked', payload: null, cap: null, code: null },
])('it settles on $name', (row) => {
  const input = settleEnvelope({
    command: 'notes.add',
    target: null,
    instance: null,
    feature: null,
    sha: null,
    durationMs: 1,
    driveEvidence: [],
    payload: {
      data: null,
      failure: row.payload,
      cursors: {},
    },
    capped: {
      data: null,
      evidence: [],
      truncatedPath: null,
      failure: row.cap,
    },
  });

  expect(input.error?.code ?? null).toBe(row.code);
});
