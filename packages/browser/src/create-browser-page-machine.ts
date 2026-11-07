import { WringerError } from '@wringer/core';
import invariant from 'tiny-invariant';
import { assign, fromCallback, fromPromise, setup } from 'xstate';
import { toPageError } from './to-page-error.ts';

export interface PageActionResult {
  readonly data: unknown;
  readonly snapshot?: string | undefined;
}

export interface PageCommand<PageHandle> {
  readonly action: (page: PageHandle) => Promise<PageActionResult>;
  readonly signal: AbortSignal;
  readonly settle: PromiseWithResolvers<unknown>;
}

interface PageInput<PageHandle> {
  readonly page: PageHandle;
  readonly closePage: (stale: PageHandle) => Promise<void>;

  // Opens a new page at the stale page's URL.
  readonly reopen: (stale: PageHandle) => Promise<PageHandle>;
}

interface PageContext<PageHandle> extends PageInput<PageHandle> {
  readonly queue: readonly PageCommand<PageHandle>[];
  readonly snapshot: string;
  readonly failure: WringerError | null;
}

type PageEvent<PageHandle> =
  | { readonly type: 'run'; readonly command: PageCommand<PageHandle> }
  | { readonly type: 'abort' }
  | { readonly type: 'stop' };

// A service call's signal aborts one second before the caller's deadline, so a page that closes
// within this bound lets the command report before that deadline.
export const pageCloseLimitMs = 500;

// Playwright cannot cancel one action, so a cancelled command fails only once its page has closed,
// and a page that does not close within the bound may still run the action, so the browser then
// refuses every later command.
export function createBrowserPageMachine<PageHandle>() {
  const pageTypes: {
    context?: PageContext<PageHandle>;
    events?: PageEvent<PageHandle>;
    input?: PageInput<PageHandle>;
  } = {};

  return setup({
    types: pageTypes,
    delays: { closeLimit: pageCloseLimitMs },
    actors: {
      runAction: fromPromise<
        PageActionResult,
        { page: PageHandle; command: PageCommand<PageHandle> }
      >((args) => args.input.command.action(args.input.page)),
      watchAbort: fromCallback<PageEvent<PageHandle>, { signal: AbortSignal }>((args) => {
        const onAbort = (): void => {
          args.sendBack({ type: 'abort' });
        };

        args.input.signal.addEventListener('abort', onAbort, { once: true });

        return () => {
          args.input.signal.removeEventListener('abort', onAbort);
        };
      }),
      closePage: fromPromise<null, Pick<PageInput<PageHandle>, 'page' | 'closePage'>>(
        async (args) => {
          await args.input.closePage(args.input.page);

          return null;
        },
      ),
      reopenPage: fromPromise<PageHandle, Pick<PageInput<PageHandle>, 'page' | 'reopen'>>((args) =>
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
          abort: 'closing',
          stop: 'stopped',
        },
      },
      closing: {
        invoke: {
          // oxlint-disable-next-line zgeoff/no-abbreviated-names -- xstate names this key `src`
          src: 'closePage',
          input: (args) => ({ page: args.context.page, closePage: args.context.closePage }),
          onDone: { target: 'reopening', actions: ['abandonHead', 'dequeue'] },
          onError: {
            target: 'broken',
            actions: assign({ failure: (args) => toCloseFailure(args.event.error) }),
          },
        },
        after: {
          closeLimit: {
            target: 'broken',
            actions: assign({
              failure: new WringerError('environment', {
                message: `The browser did not close the page of a cancelled command within ${pageCloseLimitMs} ms, so its action may still run.`,
                hint: 'Run `up --restart` to start a new browser.',
              }),
            }),
          },
        },
        on: { run: { actions: 'enqueue' }, stop: 'stopped' },
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
}

function getHead<PageHandle>(context: PageContext<PageHandle>): PageCommand<PageHandle> {
  const [head] = context.queue;

  invariant(head, 'The browser page ran a command with an empty queue.');

  return head;
}

function toCloseFailure(error: unknown): WringerError {
  return new WringerError('environment', {
    message: `The browser could not close the page of a cancelled command: ${String(error)}`,
    hint: 'Run `up --restart` to start a new browser.',
  });
}

function toReopenFailure(error: unknown): WringerError {
  return new WringerError('environment', {
    message: `The browser could not open a new page: ${String(error)}`,
    hint: 'Run `up --restart` to start a new browser.',
  });
}
