import { match } from 'ts-pattern';
import { assign, fromPromise, setup } from 'xstate';
import type { Endpoints } from './run-events.ts';
import { toWringerError } from './to-wringer-error.ts';
import { WringerError } from './wringer-error.ts';

// The process and log work of one launched app, which the machine runs as actions and actors.
interface AppMachineInput {
  readonly readyTimeoutMs: number;

  // Tells the run the app failed after its start, so the run stops.
  readonly reportCrash: (reason: string) => void;

  // Kills what is left of the app's process group once the app itself has exited.
  readonly killGroup: () => void;

  // Runs the stop command, signals the app, waits for it, then waits a bounded time for its log.
  readonly stopApp: () => Promise<void>;
}

export type AppStart =
  | { readonly kind: 'pending' }
  | { readonly kind: 'ready'; readonly endpoints: Endpoints }
  | { readonly kind: 'failed'; readonly failure: WringerError };

interface AppContext extends AppMachineInput {
  readonly start: AppStart;

  // Why the app's output could not reach its log, at any point of its life.
  readonly logFailure: string | null;
  readonly stopFailure: WringerError | null;
}

type AppEvent =
  | { readonly type: 'ready'; readonly endpoints: Endpoints }
  | { readonly type: 'exited'; readonly exitCode: number }
  | { readonly type: 'log.failed'; readonly reason: string }
  | { readonly type: 'abort' }
  | { readonly type: 'stop' };

const appTypes: { context?: AppContext; events?: AppEvent; input?: AppMachineInput } = {};
const stoppedBeforeReady = 'The run stopped before the app was ready.';

// An exit or a lost log fails a start that is not ready, and is a crash the run hears of once after
// it. Each stop waits for the app and its log. The caller waits for the tags: `settled` once the
// start is decided, and `done` once the app is down.
export const appMachine = setup({
  types: appTypes,
  actors: {
    stopApp: fromPromise<null, { readonly run: () => Promise<void> }>(async (args) => {
      await args.input.run();

      return null;
    }),
  },
  delays: {
    readyTimeout: (args) => args.context.readyTimeoutMs,
  },
  actions: {
    keepEndpoints: assign({
      start: (args): AppStart =>
        args.event.type === 'ready'
          ? { kind: 'ready', endpoints: args.event.endpoints }
          : args.context.start,
    }),
    keepLogFailure: assign({
      logFailure: (args) =>
        args.event.type === 'log.failed' ? args.event.reason : args.context.logFailure,
    }),
    failStart: assign({
      start: (args): AppStart => ({
        kind: 'failed',
        failure: new WringerError('environment', { message: describeFailure(args.event) }),
      }),
    }),
    failStartOnTimeout: assign({
      start: (args): AppStart => ({
        kind: 'failed',
        failure: new WringerError('timeout', {
          message: `The app printed no ready line within ${args.context.readyTimeoutMs} ms.`,
        }),
      }),
    }),
    reportCrash: (args) => {
      args.context.reportCrash(describeFailure(args.event));
    },
    killGroup: (args) => {
      args.context.killGroup();
    },
  },
}).createMachine({
  context: (args) => ({
    ...args.input,
    start: { kind: 'pending' },
    logFailure: null,
    stopFailure: null,
  }),
  initial: 'starting',
  states: {
    starting: {
      after: { readyTimeout: { target: 'failingStart', actions: 'failStartOnTimeout' } },
      on: {
        ready: { target: 'running', actions: 'keepEndpoints' },
        exited: { target: 'failingStart', actions: ['killGroup', 'failStart', 'reportCrash'] },
        'log.failed': {
          target: 'failingStart',
          actions: ['keepLogFailure', 'failStart', 'reportCrash'],
        },
        abort: { target: 'failingStart', actions: 'failStart' },
      },
    },
    failingStart: {
      invoke: {
        // oxlint-disable-next-line zgeoff/no-abbreviated-names -- xstate names this key `src`
        src: 'stopApp',
        input: (args) => ({ run: args.context.stopApp }),
        onDone: 'startFailed',
        onError: {
          target: 'startFailed',
          actions: assign({ stopFailure: (args) => toWringerError(args.event.error) }),
        },
      },
      on: {
        exited: { actions: 'killGroup' },
        'log.failed': { actions: 'keepLogFailure' },
      },
    },
    startFailed: { tags: ['settled', 'done'], type: 'final' },
    running: {
      tags: ['settled'],
      on: {
        exited: { target: 'crashed', actions: ['killGroup', 'reportCrash'] },
        'log.failed': { target: 'crashed', actions: ['keepLogFailure', 'reportCrash'] },
        stop: 'stopping',
      },
    },
    crashed: {
      tags: ['settled'],
      on: {
        exited: { actions: 'killGroup' },
        'log.failed': { actions: 'keepLogFailure' },
        stop: 'stopping',
      },
    },
    stopping: {
      tags: ['settled'],
      invoke: {
        // oxlint-disable-next-line zgeoff/no-abbreviated-names -- xstate names this key `src`
        src: 'stopApp',
        input: (args) => ({ run: args.context.stopApp }),
        onDone: 'stopped',
        onError: {
          target: 'stopped',
          actions: assign({ stopFailure: (args) => toWringerError(args.event.error) }),
        },
      },
      on: {
        exited: { actions: 'killGroup' },
        'log.failed': { actions: 'keepLogFailure' },
      },
    },
    stopped: { tags: ['settled', 'done'], type: 'final' },
  },
});

function describeFailure(event: AppEvent): string {
  return match(event)
    .with({ type: 'exited' }, (exited) => `The app exited with code ${exited.exitCode}.`)
    .with(
      { type: 'log.failed' },
      (failed) => `The app's output could not be logged: ${failed.reason}`,
    )
    .with({ type: 'ready' }, { type: 'abort' }, { type: 'stop' }, () => stoppedBeforeReady)
    .exhaustive();
}
