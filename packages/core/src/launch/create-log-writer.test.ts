import { expect, test } from 'bun:test';
import { createLogWriter } from './create-log-writer.ts';

function setupTest() {
  const written: string[] = [];
  const held = Promise.withResolvers<undefined>();

  return {
    written,
    release: () => {
      held.resolve(undefined);
    },
    writer: createLogWriter(async (text) => {
      if (text === 'held\n') {
        await held.promise;
      }

      if (text === 'broken\n') {
        throw new Error('disk full');
      }

      written.push(text);
    }),
  };
}

test('it writes each append in the order it came', async () => {
  const ctx = setupTest();

  await Promise.all([ctx.writer.append('first\n'), ctx.writer.append('second\n')]);

  expect(ctx.written).toStrictEqual(['first\n', 'second\n']);
});

test('it settles a close only once the append in flight is written', async () => {
  const ctx = setupTest();
  const appending = ctx.writer.append('held\n');

  const writtenAtClose = (async () => {
    await ctx.writer.close();

    return [...ctx.written];
  })();

  ctx.release();

  await appending;

  const written = await writtenAtClose;

  expect(written).toStrictEqual(['held\n']);
});

test('it writes nothing for an append after the close', async () => {
  const ctx = setupTest();

  await ctx.writer.close();
  await ctx.writer.append('late\n');

  expect(ctx.written).toStrictEqual([]);
});

test('it rejects an append whose write fails', () => {
  const ctx = setupTest();

  expect(ctx.writer.append('broken\n')).rejects.toThrow('disk full');
});

test('it writes the append after one whose write failed', async () => {
  const ctx = setupTest();

  await Promise.allSettled([ctx.writer.append('broken\n'), ctx.writer.append('next\n')]);

  expect(ctx.written).toStrictEqual(['next\n']);
});
