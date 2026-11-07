import { expect, test } from 'bun:test';
import { parsePublishedEnvelope } from './parse-published-envelope.ts';

test('it accepts an envelope that follows the published schema', () => {
  const line = JSON.stringify({
    wringer: 1,
    ok: true,
    command: 'browser.click',
    target: 'local',
    instance: 'mf3k2a-7q1z',
    feature: 'checkout',
    sha: '775243f0',
    durationMs: 412,
    data: { clicked: 'e12' },
    evidence: [{ kind: 'screenshot', path: 'shot.png', sha256: 'a'.repeat(64) }],
    cursors: { server: 120 },
    error: null,
  });

  expect(parsePublishedEnvelope(line)).toStrictEqual({ valid: true, errors: [] });
});

test('it rejects an envelope with an error code outside the closed set', () => {
  const line = JSON.stringify({
    wringer: 1,
    ok: false,
    command: 'browser.click',
    target: 'local',
    instance: 'mf3k2a-7q1z',
    feature: 'checkout',
    sha: '775243f0',
    durationMs: 412,
    data: null,
    evidence: [],
    cursors: {},
    error: { code: 'teapot', message: 'No.', hint: null },
  });

  expect(parsePublishedEnvelope(line)).toStrictEqual({
    valid: false,
    errors: expect.arrayContaining([expect.stringContaining('/error/code')]),
  });
});
