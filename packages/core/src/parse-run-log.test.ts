import { expect, test } from 'bun:test';
import { parseRunLog } from './parse-run-log.ts';

test('it skips a torn last line', () => {
  expect(
    parseRunLog('{"type":"run-ended","at":"2026-11-04T10:00:00.000Z"}\n{"type":"cra'),
  ).toStrictEqual([{ type: 'run-ended', at: '2026-11-04T10:00:00.000Z' }]);
});

test.each([
  ['a line that is no JSON', '{"type":"run-ended","at":"2026-11-04T10:00:00.000Z"}\nnot json\n'],
  ['an empty whole line', '{"type":"run-ended","at":"2026-11-04T10:00:00.000Z"}\n\n'],
  [
    'a line that is no run event',
    '{"type":"run-ended","at":"2026-11-04T10:00:00.000Z"}\n{"type":"lunch"}\n',
  ],
])('it refuses %s with an environment error', (_name, text) => {
  expect(() => parseRunLog(text)).toThrow(expect.objectContaining({ code: 'environment' }));
});

test('it skips a whole last event that has no newline yet', () => {
  expect(
    parseRunLog(
      '{"type":"launch-ready","at":"2026-11-04T10:00:00.000Z","endpoints":{}}\n{"type":"run-ended","at":"2026-11-04T10:01:00.000Z"}',
    ),
  ).toStrictEqual([{ type: 'launch-ready', at: '2026-11-04T10:00:00.000Z', endpoints: {} }]);
});
