import { expect, test } from 'bun:test';
import { renderHumanEnvelope } from './render-human-envelope.ts';

test('it prints a failure with its code, message and hint', () => {
  const text = renderHumanEnvelope({
    wringer: 1,
    ok: false,
    command: 'action.refund',
    target: 'prod',
    instance: 'mf3k2a-7q1z',
    feature: null,
    sha: null,
    durationMs: 3,
    data: null,
    evidence: [],
    cursors: {},
    error: { code: 'read-only', message: 'The refund is a write.', hint: 'Refund on staging.' },
  });

  expect(text).toBe(
    'action.refund failed (read-only): The refund is a write.\nhint: Refund on staging.\n',
  );
});

test('it prints only the Markdown of data that carries it', () => {
  const text = renderHumanEnvelope({
    wringer: 1,
    ok: true,
    command: 'report',
    target: 'local',
    instance: null,
    feature: null,
    sha: null,
    durationMs: 9,
    data: { report: {}, markdown: '## Verification\n\n- checkout: verified' },
    evidence: [],
    cursors: {},
    error: null,
  });

  expect(text).toBe('## Verification\n\n- checkout: verified\n');
});

test('it names the payload file of truncated data', () => {
  const text = renderHumanEnvelope({
    wringer: 1,
    ok: true,
    command: 'action.export',
    target: 'local',
    instance: 'mf3k2a-7q1z',
    feature: null,
    sha: null,
    durationMs: 9,
    data: null,
    evidence: [],
    cursors: {},
    truncated: true,
    truncatedPath: '.wringer/runs/mf3k2a-7q1z/payload.json',
    error: null,
  });

  expect(text).toBe(
    'action.export passed\nThe data was too large to print; it is in .wringer/runs/mf3k2a-7q1z/payload.json.\n',
  );
});
