import { expect, test } from 'bun:test';
import { z } from 'zod';
import { parseArgProperties } from './parse-arg-properties.ts';

test('it reads the type and description of each argument from its JSON Schema', () => {
  const sku = z.string().describe('The product');
  const tags = z.array(z.string());

  const properties = parseArgProperties({
    path: ['seed'],
    summary: 'Seed the shop',
    args: z.strictObject({ sku, tags, count: z.number().default(1) }),
    data: z.strictObject({}),
  });

  expect(properties).toStrictEqual({
    sku: { type: 'string', description: 'The product' },
    tags: { type: 'array', items: { type: 'string' } },
    count: { type: 'number', default: 1 },
  });
});

test('it reads the fields of every branch of an object union', () => {
  const post = z.strictObject({ mode: z.literal('post'), town: z.string() });
  const pickup = z.strictObject({ mode: z.literal('pickup'), counter: z.number() });

  const properties = parseArgProperties({
    path: ['ship'],
    summary: 'Ship an order',
    args: z.discriminatedUnion('mode', [post, pickup]),
    data: z.strictObject({}),
  });

  expect(properties).toStrictEqual({
    mode: { type: 'string', const: 'post' },
    town: { type: 'string' },
    counter: { type: 'number' },
  });
});

test('it reads a field that two union branches type differently as JSON text', () => {
  const letter = z.strictObject({ parcel: z.string() });
  const box = z.strictObject({ parcel: z.number(), fragile: z.boolean() });

  const properties = parseArgProperties({
    path: ['ship'],
    summary: 'Ship an order',
    args: z.union([letter, box]),
    data: z.strictObject({}),
  });

  expect(properties).toStrictEqual({ parcel: {}, fragile: { type: 'boolean' } });
});

test('it reads a list field whose items two union branches type differently as JSON text', () => {
  const words = z.strictObject({ kind: z.literal('words'), items: z.array(z.string()) });
  const sizes = z.strictObject({ kind: z.literal('sizes'), items: z.array(z.number()) });

  const properties = parseArgProperties({
    path: ['pack'],
    summary: 'Pack a crate',
    args: z.discriminatedUnion('kind', [words, sizes]),
    data: z.strictObject({}),
  });

  expect(properties['items']).toStrictEqual({});
});

test('it joins the choices of an enum field that two union branches declare', () => {
  const small = z.strictObject({ size: z.enum(['xs', 's']) });
  const large = z.strictObject({ size: z.enum(['l', 'xl']), crate: z.boolean() });

  const properties = parseArgProperties({
    path: ['pack'],
    summary: 'Pack a crate',
    args: z.union([small, large]),
    data: z.strictObject({}),
  });

  expect(properties['size']).toStrictEqual({ type: 'string', enum: ['xs', 's', 'l', 'xl'] });
});
