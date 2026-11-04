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
