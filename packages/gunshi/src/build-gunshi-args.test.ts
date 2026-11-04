import { expect, test } from 'bun:test';
import { z } from 'zod';
import { buildGunshiArgs } from './build-gunshi-args.ts';

test('it maps each scalar, list and enum field to the gunshi flag of its type', () => {
  const sku = z.string().describe('The product to seed');
  const tags = z.array(z.string());
  const sizes = z.array(z.number());

  const args = buildGunshiArgs({
    path: ['seed'],
    summary: 'Seed the shop',
    args: z.strictObject({
      sku,
      count: z.number().int(),
      price: z.number(),
      dryRun: z.boolean().default(true),
      tags,
      sizes,
      colour: z.enum(['red', 'blue']),
    }),
    data: z.strictObject({}),
  });

  expect(args).toStrictEqual({
    sku: { type: 'string', description: 'The product to seed' },
    count: { type: 'number' },
    price: { type: 'number' },
    dryRun: { type: 'boolean', negatable: true },
    tags: { type: 'string', multiple: true },
    sizes: { type: 'number', multiple: true },
    colour: { type: 'enum', choices: ['red', 'blue'] },
  });
});

test('it leaves the positionals out of the flags', () => {
  const argv = z.array(z.string());

  const args = buildGunshiArgs({
    path: ['exec'],
    summary: 'Run a command',
    args: z.strictObject({ host: z.string(), argv, quiet: z.boolean() }),
    positionals: ['host', 'argv'],
    data: z.strictObject({}),
  });

  expect(Object.keys(args)).toStrictEqual(['quiet']);
});

test('it takes a field that is not one scalar as JSON text', () => {
  const address = z.strictObject({ city: z.string() });

  const args = buildGunshiArgs({
    path: ['order'],
    summary: 'Place an order',
    args: z.strictObject({ address }),
    data: z.strictObject({}),
  });

  expect(args['address']?.parse?.('{"city":"Porto"}')).toStrictEqual({ city: 'Porto' });
});
