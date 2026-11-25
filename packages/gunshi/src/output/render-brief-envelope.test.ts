import { expect, test } from 'bun:test';
import { briefFieldLimit, renderBriefEnvelope } from './render-brief-envelope.ts';

test('it prints one line with the data and the evidence count for a success', () => {
  const text = renderBriefEnvelope({
    wringer: 1,
    ok: true,
    command: 'action.export',
    target: 'local',
    instance: 'mf3k2a-7q1z',
    feature: null,
    sha: null,
    durationMs: 9,
    data: { count: 3 },
    evidence: [{ kind: 'log', path: '.wringer/a.log', sha256: 'a'.repeat(64) }],
    cursors: {},
    error: null,
  });

  expect(text).toStrictEqual('action.export ok=true data={"count":3} evidence=1\n');
});

test('it prints the error code and message, with no data, for a failure', () => {
  const text = renderBriefEnvelope({
    wringer: 1,
    ok: false,
    command: 'action.refund',
    target: 'prod',
    instance: null,
    feature: null,
    sha: null,
    durationMs: 3,
    data: null,
    evidence: [],
    cursors: {},
    error: {
      code: 'read-only',
      message: 'The refund is a write.\nIt needs a writable target.',
      hint: 'Refund on staging.',
    },
  });

  expect(text).toStrictEqual(
    'action.refund ok=false error.code=read-only error.message=The refund is a write. It needs a writable target. evidence=0\n',
  );
});

test('it cuts long data at the limit and adds a marker', () => {
  const text = renderBriefEnvelope({
    wringer: 1,
    ok: true,
    command: 'action.export',
    target: 'local',
    instance: null,
    feature: null,
    sha: null,
    durationMs: 9,
    data: { rows: 'x'.repeat(500) },
    evidence: [],
    cursors: {},
    error: null,
  });

  expect(text).toStrictEqual(
    `action.export ok=true data={"rows":"${'x'.repeat(briefFieldLimit - 9)}…[truncated] evidence=0\n`,
  );
});

test('it names the payload file of data the envelope already truncated', () => {
  const text = renderBriefEnvelope({
    wringer: 1,
    ok: true,
    command: 'action.export',
    target: 'local',
    instance: 'mf3k2a-7q1z',
    feature: null,
    sha: null,
    durationMs: 9,
    data: null,
    evidence: [
      { kind: 'payload', path: '.wringer/runs/mf3k2a-7q1z/payload.json', sha256: 'b'.repeat(64) },
    ],
    cursors: {},
    truncated: true,
    truncatedPath: '.wringer/runs/mf3k2a-7q1z/payload.json',
    error: null,
  });

  expect(text).toStrictEqual(
    'action.export ok=true data=null truncatedPath=.wringer/runs/mf3k2a-7q1z/payload.json evidence=1\n',
  );
});

test('it keeps the spacing inside data and never splits an emoji at the cut', () => {
  const text = renderBriefEnvelope({
    wringer: 1,
    ok: true,
    command: 'action.export',
    target: 'local',
    instance: null,
    feature: null,
    sha: null,
    durationMs: 9,
    data: { label: `a  b${'x'.repeat(185)}😀` },
    evidence: [],
    cursors: {},
    error: null,
  });

  expect(text).toStrictEqual(
    `action.export ok=true data={"label":"a  b${'x'.repeat(185)}😀…[truncated] evidence=0\n`,
  );
});

test('it keeps one line and clips a long error message and a newline in a name', () => {
  const text = renderBriefEnvelope({
    wringer: 1,
    ok: false,
    command: 'first\nsecond',
    target: null,
    instance: null,
    feature: null,
    sha: null,
    durationMs: 0,
    data: null,
    evidence: [],
    cursors: {},
    error: { code: 'usage', message: `bad ${'y'.repeat(400)}`, hint: null },
  });

  expect(text).toStrictEqual(
    `first second ok=false error.code=usage error.message=bad ${'y'.repeat(196)}…[truncated] evidence=0\n`,
  );
});
