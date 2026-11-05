import { expect, test } from 'bun:test';
import { extraWordsArg } from './build-positional-args.ts';
import { buildRawArgs } from './build-raw-args.ts';

test('it passes only the arguments the caller gave, so the schema defaults fill the rest', () => {
  const result = buildRawArgs(
    { sku: { type: 'string' }, count: { type: 'number', default: 1 } },
    { values: { sku: 'mug', count: 1 }, explicit: { sku: true, count: false }, rest: [] },
  );

  expect(result).toStrictEqual({ ok: true, raw: { sku: 'mug' } });
});

test('it adds the words after `--` to the list positional', () => {
  const result = buildRawArgs(
    {
      host: { type: 'positional' },
      argv: { type: 'positional', multiple: true },
      [extraWordsArg]: { type: 'positional', multiple: true },
    },
    {
      values: { host: 'web-1', argv: ['ls'] },
      explicit: { host: true, argv: true },
      rest: ['-la', '/srv'],
    },
  );

  expect(result).toStrictEqual({ ok: true, raw: { host: 'web-1', argv: ['ls', '-la', '/srv'] } });
});

test('it gives the words after `--` to a list positional that took no other word', () => {
  const result = buildRawArgs(
    { argv: { type: 'positional', multiple: true } },
    { values: {}, explicit: {}, rest: ['tool', '--human'] },
  );

  expect(result).toStrictEqual({ ok: true, raw: { argv: ['tool', '--human'] } });
});

test('it converts the list words before and after `--` with the list parser', () => {
  const result = buildRawArgs(
    { sizes: { type: 'positional', multiple: true, parse: Number } },
    { values: { sizes: [1] }, explicit: { sizes: true }, rest: ['2'] },
  );

  expect(result).toStrictEqual({ ok: true, raw: { sizes: [1, 2] } });
});

test('it gives a word after `--` to an unset scalar positional, converted by its parser', () => {
  const result = buildRawArgs(
    {
      degrees: { type: 'positional', parse: Number },
      [extraWordsArg]: { type: 'positional', multiple: true },
    },
    { values: {}, explicit: {}, rest: ['-15'] },
  );

  expect(result).toStrictEqual({ ok: true, raw: { degrees: -15 } });
});

test('it gives a word after `--` to a scalar positional named after an inherited key', () => {
  const result = buildRawArgs(
    {
      constructor: { type: 'positional' as const },
      [extraWordsArg]: { type: 'positional', multiple: true },
    },
    { values: {}, explicit: {}, rest: ['-shelf'] },
  );

  expect(result).toStrictEqual({ ok: true, raw: { constructor: '-shelf' } });
});

test('it fills the unset scalar positionals in order before the list takes the other words', () => {
  const result = buildRawArgs(
    {
      host: { type: 'positional' },
      argv: { type: 'positional', multiple: true },
      [extraWordsArg]: { type: 'positional', multiple: true },
    },
    { values: {}, explicit: {}, rest: ['-web-1', '-la', '/srv'] },
  );

  expect(result).toStrictEqual({ ok: true, raw: { host: '-web-1', argv: ['-la', '/srv'] } });
});

test.each([
  { name: 'a word no positional takes', values: { [extraWordsArg]: ['prod'] }, rest: [] },
  { name: 'a word after `--` with no list positional', values: {}, rest: ['prod'] },
])('it returns a usage failure for $name', (row) => {
  const result = buildRawArgs(
    { [extraWordsArg]: { type: 'positional', multiple: true } },
    { values: row.values, explicit: {}, rest: row.rest },
  );

  expect(result).toStrictEqual({
    ok: false,
    error: expect.objectContaining({
      code: 'usage',
      message: 'The command takes no argument `prod`.',
    }),
  });
});
