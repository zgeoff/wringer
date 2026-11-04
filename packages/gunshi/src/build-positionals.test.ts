import { expect, test } from 'bun:test';
import { z } from 'zod';
import { buildPositionals } from './build-positionals.ts';

test('it lists the positionals in declared order with the type of their words', () => {
  const sizes = z.array(z.number());

  const positionals = buildPositionals({
    path: ['copy'],
    summary: 'Copy a file',
    args: z.strictObject({ destination: z.string(), source: z.string().optional(), sizes }),
    positionals: ['source', 'destination', 'sizes'],
    data: z.strictObject({}),
  });

  expect(positionals).toStrictEqual([
    { name: 'source', type: 'string', list: false },
    { name: 'destination', type: 'string', list: false },
    { name: 'sizes', type: 'number', list: true },
  ]);
});

test('it lists none for a command that declares none', () => {
  const positionals = buildPositionals({
    path: ['status'],
    summary: 'Show the run',
    args: z.strictObject({}),
    data: z.strictObject({}),
  });

  expect(positionals).toStrictEqual([]);
});
