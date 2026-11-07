import { expect, onTestFinished, test } from 'bun:test';
import { createActor } from 'xstate';
import { createBrowserPageMachine } from './create-browser-page-machine.ts';
import type { PageActionResult } from './create-browser-page-machine.ts';

interface StubPage {
  readonly name: string;
}

interface StubPageMoves {
  readonly closePage: (stale: StubPage) => Promise<void>;
  readonly reopen: (stale: StubPage) => Promise<StubPage>;
}

function setupTest() {
  return {
    startPage: (pages: StubPageMoves) => {
      const actor = createActor(createBrowserPageMachine<StubPage>(), {
        input: { page: { name: 'first' }, ...pages },
      });

      actor.start();

      onTestFinished(() => {
        actor.stop();
      });

      return {
        run: (action: (page: StubPage) => Promise<PageActionResult>, signal: AbortSignal) => {
          const settle = Promise.withResolvers<unknown>();

          actor.send({ type: 'run', command: { action, signal, settle } });

          return settle.promise;
        },
      };
    },
  };
}

test('it fails a cancelled command with a timeout once its page closed, and runs the next on the new page', async () => {
  const ctx = setupTest();

  const page = ctx.startPage({
    closePage: () => Promise.resolve(),
    reopen: () => Promise.resolve({ name: 'second' }),
  });

  const cancel = new AbortController();

  const cancelled = page.run(() => Promise.withResolvers<never>().promise, cancel.signal);

  const queued = page.run(
    (current) => Promise.resolve({ data: current.name }),
    new AbortController().signal,
  );

  cancel.abort();

  const settled = await Promise.allSettled([cancelled, queued]);

  expect(settled).toStrictEqual([
    {
      status: 'rejected',
      reason: expect.objectContaining({
        code: 'timeout',
        message: 'The command ran past its deadline, so the browser closed its page.',
      }),
    },
    { status: 'fulfilled', value: 'second' },
  ]);
});

test.each([
  {
    name: 'its page fails to close',
    closePage: () => Promise.reject(new Error('the page crashed')),
    reopen: () => Promise.resolve({ name: 'second' }),
    message: 'The browser could not close the page of a cancelled command: Error: the page crashed',
  },
  {
    name: 'its page does not close within the bound',
    closePage: () => Promise.withResolvers<never>().promise,
    reopen: () => Promise.resolve({ name: 'second' }),
    message:
      'The browser did not close the page of a cancelled command within 500 ms, so its action may still run.',
  },
  {
    name: 'no new page opens',
    closePage: () => Promise.resolve(),
    reopen: () => Promise.reject(new Error('the browser is gone')),
    message: 'The browser could not open a new page: Error: the browser is gone',
  },
])(
  'it fails the commands queued behind a cancelled command, and those after it, when $name',
  async (row) => {
    const ctx = setupTest();
    const page = ctx.startPage({ closePage: row.closePage, reopen: row.reopen });

    const cancel = new AbortController();

    const cancelled = page.run(() => Promise.withResolvers<never>().promise, cancel.signal);

    const queued = page.run(
      () => Promise.resolve({ data: 'queued' }),
      new AbortController().signal,
    );

    cancel.abort();

    const [, queuedSettled] = await Promise.allSettled([cancelled, queued]);

    const running = page.run(
      () => Promise.resolve({ data: 'later' }),
      new AbortController().signal,
    );

    const [later] = await Promise.allSettled([running]);

    const failure = {
      status: 'rejected' as const,
      reason: expect.objectContaining({ code: 'environment', message: row.message }),
    };

    expect({ queued: queuedSettled, later }).toStrictEqual({ queued: failure, later: failure });
  },
);
