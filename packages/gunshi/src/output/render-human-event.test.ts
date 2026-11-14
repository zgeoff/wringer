import { expect, test } from 'bun:test';
import { renderHumanEvent } from './render-human-event.ts';

test('it prints a stream event as its name and data on one line', () => {
  const text = renderHumanEvent(
    '{"wringer":1,"event":"check","data":{"name":"notes.store","status":"passed"}}',
  );

  expect(text).toBe('check: {"name":"notes.store","status":"passed"}\n');
});
