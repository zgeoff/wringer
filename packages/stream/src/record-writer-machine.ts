import { WringerError } from '@wringer/core';
import { assign, fromPromise, setup } from 'xstate';

interface WriterInput {
  readonly path: string;
  readonly pendingLimit: number;
  readonly now: () => Date;
  readonly write: (text: string) => Promise<void>;
  readonly onError: (error: unknown) => void;
}

interface WriterContext extends WriterInput {
  readonly pending: readonly string[];
  readonly batch: readonly string[];
  readonly batchDropped: number;
  readonly dropped: number;
  readonly failure: string | null;
  readonly drains: readonly PromiseWithResolvers<null>[];
}

type WriterEvent =
  | { readonly type: 'add'; readonly record: string }
  | { readonly type: 'drain'; readonly settle: PromiseWithResolvers<null> };

const writerTypes: { context?: WriterContext; events?: WriterEvent; input?: WriterInput } = {};

interface BatchInput {
  readonly write: WriterInput['write'];
  readonly lines: readonly string[];
}

// Appends the records that arrived while the last write ran in one write, so a fast source costs
// one write per batch and a bounded amount of memory. A batch that fails to write goes back to the
// front of the queue: the next record retries it, and a drain retries it once, then rejects.
export const recordWriterMachine = setup({
  types: writerTypes,
  actors: {
    writeBatch: fromPromise<null, BatchInput>(async (args) => {
      await args.input.write(`${args.input.lines.join('\n')}\n`);

      return null;
    }),
  },
  guards: {
    hasPending: (args) => args.context.pending.length > 0 || args.context.dropped > 0,
  },
  actions: {
    enqueue: assign((args) => {
      if (args.event.type !== 'add') {
        return {};
      }

      return args.context.pending.length >= args.context.pendingLimit
        ? { dropped: args.context.dropped + 1 }
        : { pending: [...args.context.pending, args.event.record] };
    }),
    takeBatch: assign((args) => ({
      batch: args.context.pending,
      batchDropped: args.context.dropped,
      pending: [],
      dropped: 0,
    })),
    keepBatch: assign((args) => {
      const kept = [...args.context.batch, ...args.context.pending];
      const limit = args.context.pendingLimit;

      return {
        batch: [],
        batchDropped: 0,
        pending: kept.slice(0, limit),
        dropped:
          args.context.batchDropped + args.context.dropped + Math.max(kept.length - limit, 0),
      };
    }),
    keepDrain: assign({
      drains: (args) =>
        args.event.type === 'drain'
          ? [...args.context.drains, args.event.settle]
          : args.context.drains,
    }),
    resolveDrains: assign((args) => {
      for (const drain of args.context.drains) {
        drain.resolve(null);
      }

      return { drains: [] };
    }),
    rejectDrains: assign((args) => {
      const error = new WringerError('environment', {
        message: `${args.context.path} kept ${args.context.pending.length} records the recorder could not write: ${args.context.failure ?? 'the write failed'}`,
      });

      for (const drain of args.context.drains) {
        drain.reject(error);
      }

      return { drains: [] };
    }),
  },
}).createMachine({
  context: (args) => ({
    ...args.input,
    pending: [],
    batch: [],
    batchDropped: 0,
    dropped: 0,
    failure: null,
    drains: [],
  }),
  initial: 'idle',
  states: {
    idle: {
      entry: 'resolveDrains',
      on: {
        add: { target: 'writing', actions: 'enqueue' },
        drain: { actions: ['keepDrain', 'resolveDrains'] },
      },
    },
    writing: {
      entry: 'takeBatch',
      invoke: {
        // oxlint-disable-next-line zgeoff/no-abbreviated-names -- xstate names this key `src`
        src: 'writeBatch',
        input: (args) => ({
          write: args.context.write,
          lines: [
            ...args.context.batch,
            ...buildDropNotice(args.context.batchDropped, args.context.now),
          ],
        }),
        onDone: [
          {
            guard: 'hasPending',
            target: 'writing',
            reenter: true,
            actions: assign({ batch: [], batchDropped: 0, failure: null }),
          },
          { target: 'idle', actions: assign({ batch: [], batchDropped: 0, failure: null }) },
        ],
        onError: {
          target: 'stalled',
          actions: [
            'keepBatch',
            assign({
              failure: (args) =>
                args.event.error instanceof Error ? args.event.error.message : 'the write failed',
            }),
            (args) => {
              args.context.onError(args.event.error);
            },
          ],
        },
      },
      on: { add: { actions: 'enqueue' }, drain: { actions: 'keepDrain' } },
    },
    stalled: {
      entry: 'rejectDrains',
      on: {
        add: { target: 'writing', actions: 'enqueue' },
        drain: { target: 'writing', actions: 'keepDrain' },
      },
    },
  },
});

function buildDropNotice(dropped: number, now: () => Date): string[] {
  if (dropped === 0) {
    return [];
  }

  const line = `[wringer] the recorder dropped ${dropped} lines while it caught up`;

  return [JSON.stringify({ at: now().toISOString(), line })];
}
