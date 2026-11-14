import { expect, test } from 'bun:test';
import { parseArgs, resolveArgs } from 'gunshi';
import { extraWordsArg } from './build-positional-args.ts';
import { buildRawArgs } from './build-raw-args.ts';

test('it passes only the arguments the caller gave, so the schema defaults fill the rest', () => {
  const result = buildRawArgs(
    { sku: { type: 'string' }, count: { type: 'number', default: 1 } },
    {
      tokens: parseArgs(['--sku', 'mug']),
      values: { sku: 'mug', count: 1 },
      explicit: { sku: true, count: false },
      rest: [],
    },
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
      tokens: parseArgs(['web-1', 'ls', '--', '-la', '/srv']),
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
    {
      tokens: parseArgs(['--', 'tool', '--human']),
      values: {},
      explicit: {},
      rest: ['tool', '--human'],
    },
  );

  expect(result).toStrictEqual({ ok: true, raw: { argv: ['tool', '--human'] } });
});

test.each([
  { argv: ['--', 'printf', '%s', ''], words: ['printf', '%s', ''] },
  { argv: ['--', '', 'tool', ''], words: ['', 'tool', ''] },
  { argv: ['ls', '', '--', '-la', ''], words: ['ls', '', '-la', ''] },
])('it keeps each empty word of $argv in its place in the list positional', (row) => {
  const args = {
    argv: { type: 'positional', multiple: true },
    [extraWordsArg]: { type: 'positional', multiple: true },
  } as const;

  const tokens = parseArgs([...row.argv]);
  const result = buildRawArgs(args, { ...resolveArgs(args, tokens), tokens });

  expect(result).toStrictEqual({ ok: true, raw: { argv: row.words } });
});

test.each([
  { argv: ['mug', 'cup'] },
  { argv: ['--', 'mug', 'cup'] },
  { argv: ['mug', '--', 'cup'] },
])('it gives every word of $argv to a list declared before a scalar positional', (row) => {
  const args = {
    items: { type: 'positional', required: false, multiple: true },
    suffix: { type: 'positional', required: false },
    [extraWordsArg]: { type: 'positional', required: false, multiple: true },
  } as const;

  const tokens = parseArgs([...row.argv]);
  const result = buildRawArgs(args, { ...resolveArgs(args, tokens), tokens });

  expect(result).toStrictEqual({ ok: true, raw: { items: ['mug', 'cup'] } });
});

test('it gives an empty word after `--` to the next unset scalar positional in its place', () => {
  const args = {
    host: { type: 'positional' },
    argv: { type: 'positional', multiple: true },
    [extraWordsArg]: { type: 'positional', multiple: true },
  } as const;

  const tokens = parseArgs(['--', '-web-1', '', 'ls']);
  const result = buildRawArgs(args, { ...resolveArgs(args, tokens), tokens });

  expect(result).toStrictEqual({ ok: true, raw: { host: '-web-1', argv: ['', 'ls'] } });
});

test('it converts the list words before and after `--` with the list parser', () => {
  const result = buildRawArgs(
    { sizes: { type: 'positional', multiple: true, parse: Number } },
    {
      tokens: parseArgs(['1', '--', '2']),
      values: { sizes: [1] },
      explicit: { sizes: true },
      rest: ['2'],
    },
  );

  expect(result).toStrictEqual({ ok: true, raw: { sizes: [1, 2] } });
});

test('it gives a word after `--` to an unset scalar positional, converted by its parser', () => {
  const result = buildRawArgs(
    {
      degrees: { type: 'positional', parse: Number },
      [extraWordsArg]: { type: 'positional', multiple: true },
    },
    { tokens: parseArgs(['--', '-15']), values: {}, explicit: {}, rest: ['-15'] },
  );

  expect(result).toStrictEqual({ ok: true, raw: { degrees: -15 } });
});

test('it keeps a null that a scalar positional parser returns for a word after `--`', () => {
  const result = buildRawArgs(
    {
      shelf: { type: 'positional', parse: (word: string): unknown => JSON.parse(word) },
      [extraWordsArg]: { type: 'positional', multiple: true },
    },
    { tokens: parseArgs(['--', 'null']), values: {}, explicit: {}, rest: ['null'] },
  );

  expect(result).toStrictEqual({ ok: true, raw: { shelf: null } });
});

test('it keeps a null that a list positional parser returns for a word after `--`', () => {
  const result = buildRawArgs(
    {
      sizes: {
        type: 'positional',
        multiple: true,
        parse: (word: string): unknown => JSON.parse(word),
      },
    },
    { tokens: parseArgs(['--', 'null', '3']), values: {}, explicit: {}, rest: ['null', '3'] },
  );

  expect(result).toStrictEqual({ ok: true, raw: { sizes: [null, 3] } });
});

test('it gives a word after `--` to a scalar positional named after an inherited key', () => {
  const result = buildRawArgs(
    {
      constructor: { type: 'positional' as const },
      [extraWordsArg]: { type: 'positional', multiple: true },
    },
    { tokens: parseArgs(['--', '-shelf']), values: {}, explicit: {}, rest: ['-shelf'] },
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
    {
      tokens: parseArgs(['--', '-web-1', '-la', '/srv']),
      values: {},
      explicit: {},
      rest: ['-web-1', '-la', '/srv'],
    },
  );

  expect(result).toStrictEqual({ ok: true, raw: { host: '-web-1', argv: ['-la', '/srv'] } });
});

test.each([
  {
    name: 'a word no positional takes',
    argv: ['prod'],
    values: { [extraWordsArg]: ['prod'] },
    explicit: { [extraWordsArg]: true },
    rest: [],
  },
  {
    name: 'a word after `--` with no list positional',
    argv: ['--', 'prod'],
    values: {},
    explicit: {},
    rest: ['prod'],
  },
])('it returns a usage failure for $name', (row) => {
  const result = buildRawArgs(
    { [extraWordsArg]: { type: 'positional', multiple: true } },
    {
      tokens: parseArgs([...row.argv]),
      values: row.values,
      explicit: row.explicit,
      rest: row.rest,
    },
  );

  expect(result).toStrictEqual({
    ok: false,
    error: expect.objectContaining({
      code: 'usage',
      message: 'The command takes no argument `prod`.',
    }),
  });
});
