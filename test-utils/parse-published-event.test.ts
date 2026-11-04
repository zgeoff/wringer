import { expect, test } from 'bun:test';
import { parsePublishedEvent } from './parse-published-event.ts';

test('it accepts an event line that follows the published schema', () => {
  const line = JSON.stringify({ wringer: 1, event: 'check', data: { name: 'shelf' } });

  expect(parsePublishedEvent(line)).toStrictEqual({ valid: true, errors: [] });
});

test('it rejects an event line with no event name', () => {
  const line = JSON.stringify({ wringer: 1, event: '', data: null });

  expect(parsePublishedEvent(line)).toStrictEqual({
    valid: false,
    errors: ['/event must NOT have fewer than 1 characters'],
  });
});
