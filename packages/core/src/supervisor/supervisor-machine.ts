import { and, assign, fromPromise, not, raise, setup } from 'xstate';
import { toWringerError } from '../to-wringer-error.ts';
import type { WringerError } from '../wringer-error.ts';

export interface ShutDownPlan {
  readonly crashReason: string | null;

  // True when the stop stopped waiting for a startup that ignored the abort.
  readonly gaveUpOnStartup: boolean;
}

// The supervisor's I/O, which the machine runs as actors and actions.
interface SupervisorMachineInput {
  readonly stopWaitMs: number;
  readonly startUp: () => Promise<void>;

  // Tells the startup to give up, so a stop during startup ends it early.
  readonly abortStartup: () => void;
  readonly shutDown: (plan: ShutDownPlan) => Promise<WringerError | null>;

  // Stops each part that came up after the stop stopped waiting for it.
  readonly cleanUpLate: () => Promise<void>;
}

interface SupervisorContext extends SupervisorMachineInput {
  readonly crashReason: string | null;
  readonly gaveUpOnStartup: boolean;
  readonly startupSettled: boolean;

  // The failure of the final log write, which each stop's caller receives.
  readonly failure: WringerError | null;
}

type SupervisorEvent =
  | { readonly type: 'stop'; readonly reason: string | null }
  | { readonly type: 'startup.done' }
  | { readonly type: 'startup.failed'; readonly reason: string };

const supervisorTypes: {
  context?: SupervisorContext;
  events?: SupervisorEvent;
  input?: SupervisorMachineInput;
} = {};

interface RunInput<Input, Output> {
  readonly run: (input: Input) => Promise<Output>;
  readonly input: Input;
}

// The run is up once startup is done, and the first stop or crash names the reason. A stop during
// startup waits a bounded time for the startup; a part that comes up after that still stops, once
// the run's log is closed. Each state in which the run's log is closed carries the `closed` tag.
export const supervisorMachine = setup({
  types: supervisorTypes,
  actors: {
    startUp: fromPromise<null, RunInput<null, void>>(async (args) => {
      await args.input.run(null);

      return null;
    }),
    shutDown: fromPromise<WringerError | null, RunInput<ShutDownPlan, WringerError | null>>(
      (args) => args.input.run(args.input.input),
    ),
    cleanUpLate: fromPromise<null, RunInput<null, void>>(async (args) => {
      await args.input.run(null);

      return null;
    }),
  },
  delays: {
    stopWait: (args) => args.context.stopWaitMs,
  },
  guards: {
    gaveUpOnStartup: (args) => args.context.gaveUpOnStartup,
    startupSettled: (args) => args.context.startupSettled,
  },
  actions: {
    keepStopReason: assign({
      crashReason: (args) => (args.event.type === 'stop' ? args.event.reason : null),
    }),
    keepStartupFailure: assign({
      crashReason: (args) => (args.event.type === 'startup.failed' ? args.event.reason : null),
    }),
    abortStartup: (args) => {
      args.context.abortStartup();
    },
    giveUpOnStartup: assign({ gaveUpOnStartup: true }),
    settleStartup: assign({ startupSettled: true }),
  },
}).createMachine({
  context: (args) => ({
    ...args.input,
    crashReason: null,
    gaveUpOnStartup: false,
    startupSettled: false,
    failure: null,
  }),
  invoke: {
    // oxlint-disable-next-line zgeoff/no-abbreviated-names -- xstate names this key `src`
    src: 'startUp',
    input: (args) => ({ run: args.context.startUp, input: null }),
    onDone: { actions: ['settleStartup', raise({ type: 'startup.done' })] },
    onError: {
      actions: [
        'settleStartup',
        raise((args) => ({
          type: 'startup.failed' as const,
          reason: toWringerError(args.event.error).message,
        })),
      ],
    },
  },
  initial: 'starting',
  states: {
    starting: {
      on: {
        stop: { target: 'waitingForStartup', actions: 'keepStopReason' },
        'startup.done': 'running',
        'startup.failed': { target: 'shuttingDown', actions: 'keepStartupFailure' },
      },
    },
    running: {
      on: { stop: { target: 'shuttingDown', actions: 'keepStopReason' } },
    },
    waitingForStartup: {
      entry: 'abortStartup',
      after: { stopWait: { target: 'shuttingDown', actions: 'giveUpOnStartup' } },
      on: { 'startup.done': 'shuttingDown', 'startup.failed': 'shuttingDown' },
    },
    shuttingDown: {
      entry: 'abortStartup',
      invoke: {
        // oxlint-disable-next-line zgeoff/no-abbreviated-names -- xstate names this key `src`
        src: 'shutDown',
        input: (args) => ({
          run: args.context.shutDown,
          input: {
            crashReason: args.context.crashReason,
            gaveUpOnStartup: args.context.gaveUpOnStartup,
          },
        }),
        onDone: { target: 'closed', actions: assign({ failure: (args) => args.event.output }) },
        onError: {
          target: 'closed',
          actions: assign({ failure: (args) => toWringerError(args.event.error) }),
        },
      },
    },
    closed: {
      tags: ['closed'],
      always: [
        { guard: and(['gaveUpOnStartup', 'startupSettled']), target: 'cleaningUpLate' },
        { guard: not('gaveUpOnStartup'), target: 'ended' },
      ],
      on: { 'startup.done': 'cleaningUpLate', 'startup.failed': 'cleaningUpLate' },
    },
    cleaningUpLate: {
      tags: ['closed'],
      invoke: {
        // oxlint-disable-next-line zgeoff/no-abbreviated-names -- xstate names this key `src`
        src: 'cleanUpLate',
        input: (args) => ({ run: args.context.cleanUpLate, input: null }),
        onDone: 'ended',
        onError: 'ended',
      },
    },
    ended: { tags: ['closed'], type: 'final' },
  },
});
