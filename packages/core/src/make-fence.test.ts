import { expect, test } from 'bun:test';
import { makeFence } from './make-fence.ts';

test('it refuses a write on a read-only target with the target hint', () => {
  const fence = makeFence({ access: 'read-only', hint: 'Refund on staging.' });

  const refund = fence<{ readonly order: string }, string>({
    effect: () => 'write',
    describe: (args) => `refund ${args.order}`,
    run: (args) => Promise.resolve(`refunded ${args.order}`),
  });

  expect(refund({ order: 'A-7' })).rejects.toMatchObject({
    code: 'read-only',
    message: 'refund A-7 is a write, and the target is read-only.',
    hint: 'Refund on staging.',
  });
});

test('it runs a read on a read-only target', async () => {
  const fence = makeFence({ access: 'read-only', hint: 'Refund on staging.' });

  const refund = fence<{ readonly order: string }, string>({
    effect: () => 'read',
    describe: (args) => `refund ${args.order}`,
    run: (args) => Promise.resolve(`refunded ${args.order}`),
  });

  const result = await refund({ order: 'A-7' });

  expect(result).toBe('refunded A-7');
});

test('it runs a write on a read-write target', async () => {
  const fence = makeFence({ access: 'read-write', hint: 'Refund on staging.' });

  const refund = fence<{ readonly order: string }, string>({
    effect: () => 'write',
    describe: (args) => `refund ${args.order}`,
    run: (args) => Promise.resolve(`refunded ${args.order}`),
  });

  const result = await refund({ order: 'A-7' });

  expect(result).toBe('refunded A-7');
});
