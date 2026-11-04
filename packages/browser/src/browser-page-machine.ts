import { WringerError } from '@wringer/core';
import type { Page } from 'playwright-core';
import { assign, fromCallback, fromPromise, setup } from 'xstate';
import { toPageError } from './to-page-error.ts';

export interface PageActionResult {
  readonly data: unknown;
  readonly snapshot?: string | undefined;
}

export interface PageCommand {
  readonly action: (page: Page) => Promise<PageActionResult>;
  readonly signal: AbortSignal;
  readonly settle: PromiseWithResolvers<unknown>;
}

interface PageInput {
  readonly page: Page;
  readonly reopen: (stale: Page) => Promise<Page>;
}

interface PageContext extends PageInput {
  readonly queue: readonly PageCommand[];
  readonly snapshot: string;
  readonly failure: WringerError | null;
}

type PageEvent =
  | { readonly type: 'run'; readonly command: PageCommand }
  | { readonly type: 'abort' }
  | { readonly type: 'stop' };

const pageTypes: { context?: PageContext; events?: PageEvent; input?: PageInput } = {};

// One page serves every command of a run, one command at a time. Playwright cannot cancel one
// action, so a command whose caller stops waiting gets its page closed and replaced at the same URL
// before the next command starts; a command whose deadline passed in the queue never starts.
export const browserPageMachine = setup({
  types: pageTypes,
  actors: {
    runAction: fromPromise<PageActionResult, { page: Page; command: PageCommand }>((args) =>
      args.input.command.action(args.input.page),
    ),
    watchAbort: fromCallback<PageEvent, { signal: AbortSignal }>((args) => {
      const onAbort = (): void => {
        args.sendBack({ type: 'abort' });
      };

      args.input.signal.addEventListener('abort', onAbort, { once: true });

      return () => {
        args.input.signal.removeEventListener('abort', onAbort);
      };
    }),
    reopenPage: fromPromise<Page, Pick<PageInput, 'page' | 'reopen'>>((args) =>
      args.input.reopen(args.input.page),
    ),
  },
  guards: {
    hasQueue: (args) => args.context.queue.length > 0,
    isHeadAborted: (args) => args.context.queue[0]?.signal.aborted === true,
  },
  actions: {
    enqueue: assign({
      queue: (args) =>
        args.event.type === 'run'
          ? [...args.context.queue, args.event.command]
          : args.context.queue,
    }),
    dequeue: assign({ queue: (args) => args.context.queue.slice(1) }),
    refuseLateHead: (args) => {
      args.context.queue[0]?.settle.reject(
        new WringerError('timeout', {
          message: 'The command ran past its deadline before the browser started it.',
        }),
      );
    },
    abandonHead: (args) => {
      args.context.queue[0]?.settle.reject(
        new WringerError('timeout', {
          message: 'The command ran past its deadline, so the browser closed its page.',
        }),
      );
    },
    rejectQueue: (args) => {
      for (const command of args.context.queue) {
        command.settle.reject(args.context.failure);
      }
    },
    clearQueue: assign({ queue: [] }),
    rejectRun: (args) => {
      if (args.event.type === 'run') {
        args.event.command.settle.reject(args.context.failure);
      }
    },
  },
}).createMachine({
  context: (args) => ({ ...args.input, queue: [], snapshot: '', failure: null }),
  initial: 'idle',
  states: {
    idle: {
      always: [
        { guard: 'isHeadAborted', actions: ['refuseLateHead', 'dequeue'] },
        { guard: 'hasQueue', target: 'running' },
      ],
      on: { run: { actions: 'enqueue' }, stop: 'stopped' },
    },
    running: {
      invoke: [
        {
          // oxlint-disable-next-line zgeoff/no-abbreviated-names -- xstate names this key `src`
          src: 'runAction',
          input: (args) => ({ page: args.context.page, command: getHead(args.context) }),
          onDone: {
            target: 'idle',
            actions: [
              assign({
                snapshot: (args) => args.event.output.snapshot ?? args.context.snapshot,
              }),
              (args) => {
                args.context.queue[0]?.settle.resolve(args.event.output.data);
              },
              'dequeue',
            ],
          },
          onError: {
            target: 'idle',
            actions: [
              (args) => {
                args.context.queue[0]?.settle.reject(toPageError(args.event.error));
              },
              'dequeue',
            ],
          },
        },
        {
          // oxlint-disable-next-line zgeoff/no-abbreviated-names -- xstate names this key `src`
          src: 'watchAbort',
          input: (args) => ({ signal: getHead(args.context).signal }),
        },
      ],
      on: {
        run: { actions: 'enqueue' },
        abort: { target: 'reopening', actions: ['abandonHead', 'dequeue'] },
        stop: 'stopped',
      },
    },
    reopening: {
      invoke: {
        // oxlint-disable-next-line zgeoff/no-abbreviated-names -- xstate names this key `src`
        src: 'reopenPage',
        input: (args) => ({ page: args.context.page, reopen: args.context.reopen }),
        onDone: { target: 'idle', actions: assign({ page: (args) => args.event.output }) },
        onError: {
          target: 'broken',
          actions: assign({ failure: (args) => toReopenFailure(args.event.error) }),
        },
      },
      on: { run: { actions: 'enqueue' }, stop: 'stopped' },
    },
    broken: {
      entry: ['rejectQueue', 'clearQueue'],
      on: { run: { actions: 'rejectRun' }, stop: 'stopped' },
    },
    stopped: {
      entry: [
        assign({
          failure: new WringerError('environment', {
            message: 'The browser closed, so it cannot run the command.',
            hint: 'Run `up --restart` to start a new browser.',
          }),
        }),
        'rejectQueue',
        'clearQueue',
      ],
      on: { run: { actions: 'rejectRun' } },
    },
  },
});

function getHead(context: PageContext): PageCommand {
  const [head] = context.queue;

  if (head === undefined) {
    throw new Error('The browser page ran a command with an empty queue.');
  }

  return head;
}

function toReopenFailure(error: unknown): WringerError {
  return new WringerError('environment', {
    message: `The browser could not open a new page: ${String(error)}`,
    hint: 'Run `up --restart` to start a new browser.',
  });
}
