import { expect, test } from 'bun:test';
import { parseWalkCache } from './parse-walk-cache.ts';

test('it parses a cache of reached files and warnings', () => {
  const text = JSON.stringify({ core: { reached: ['a.ts'], warnings: ['a.ts:1: x'] } });

  expect(parseWalkCache(text)).toStrictEqual({
    core: { reached: ['a.ts'], warnings: ['a.ts:1: x'] },
  });
});

test.each(['', '{"core":', '{"core":{"reached":1}}', '[]'])(
  'it returns null for the text %p',
  (text) => {
    expect(parseWalkCache(text)).toBeNull();
  },
);
