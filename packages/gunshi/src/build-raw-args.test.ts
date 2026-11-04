import { expect, test } from 'bun:test';
import { buildRawArgs } from './build-raw-args.ts';

test('it passes only the flags the caller gave, so the schema defaults fill the rest', () => {
  const raw = buildRawArgs({ sku: { type: 'string' }, count: { type: 'number', default: 1 } }, [], {
    values: { sku: 'mug', count: 1 },
    explicit: { sku: true, count: false },
    words: [],
  });

  expect(raw).toStrictEqual({ sku: 'mug' });
});

test('it fills the positionals in declared order, the list taking the words left', () => {
  const raw = buildRawArgs(
    {},
    [
      { name: 'host', type: 'string', list: false },
      { name: 'argv', type: 'string', list: true },
    ],
    { values: {}, explicit: {}, words: ['web-1', 'ls', '-la', '/srv'] },
  );

  expect(raw).toStrictEqual({ host: 'web-1', argv: ['ls', '-la', '/srv'] });
});

test('it converts the words of number and boolean positionals', () => {
  const raw = buildRawArgs(
    {},
    [
      { name: 'count', type: 'integer', list: false },
      { name: 'force', type: 'boolean', list: false },
      { name: 'sizes', type: 'number', list: true },
    ],
    { values: {}, explicit: {}, words: ['3', 'true', '1.5', 'large'] },
  );

  expect(raw).toStrictEqual({ count: 3, force: true, sizes: [1.5, 'large'] });
});

test('it leaves a positional with no word out, for the schema to require or default', () => {
  const raw = buildRawArgs({}, [{ name: 'file', type: 'string', list: false }], {
    values: {},
    explicit: {},
    words: [],
  });

  expect(raw).toStrictEqual({});
});

test('it refuses a word no positional takes', () => {
  expect(() => buildRawArgs({}, [], { values: {}, explicit: {}, words: ['prod'] })).toThrow(
    expect.objectContaining({ code: 'usage' }),
  );
});
