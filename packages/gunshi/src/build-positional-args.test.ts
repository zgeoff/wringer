import { expect, test } from 'bun:test';
import { z } from 'zod';
import { buildPositionalArgs, extraWordsArg } from './build-positional-args.ts';

test('it declares the positionals in order, the list taking many words, then the extra words', () => {
  const sizes = z.array(z.number());

  const args = buildPositionalArgs({
    path: ['copy'],
    summary: 'Copy a file',
    args: z.strictObject({ destination: z.string(), source: z.string().optional(), sizes }),
    positionals: ['source', 'destination', 'sizes'],
    data: z.strictObject({}),
  });

  expect(
    Object.entries(args).map(([name, schema]) => [name, schema.multiple ?? false]),
  ).toStrictEqual([
    ['source', false],
    ['destination', false],
    ['sizes', true],
    [extraWordsArg, true],
  ]);
});

test.each([
  { type: 'integer', word: '3', value: 3 },
  { type: 'number', word: '1.5', value: 1.5 },
  { type: 'number', word: 'large', value: 'large' },
  { type: 'number', word: ' ', value: ' ' },
  { type: 'boolean', word: 'true', value: true },
  { type: 'boolean', word: 'yes', value: 'yes' },
  { type: 'string', word: '42', value: '42' },
] as const)('it converts the $type word $word to $value', (row) => {
  const field = {
    integer: z.number().int(),
    number: z.number(),
    boolean: z.boolean(),
    string: z.string(),
  }[row.type];

  const args = buildPositionalArgs({
    path: ['set'],
    summary: 'Set a value',
    args: z.strictObject({ value: field }),
    positionals: ['value'],
    data: z.strictObject({}),
  });

  expect(args['value']?.parse?.(row.word)).toBe(row.value);
});

test('it declares only the extra words for a node that groups commands', () => {
  const args = buildPositionalArgs(null);

  expect(Object.keys(args)).toStrictEqual([extraWordsArg]);
});
