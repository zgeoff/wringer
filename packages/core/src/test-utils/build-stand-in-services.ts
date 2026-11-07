import { once } from 'node:events';
import type { ServiceContext, ServiceInstance } from '../types.ts';
import { WringerError } from '../wringer-error.ts';

export interface StandInDependencies {
  readonly stop: Promise<unknown>;
  readonly start: Promise<unknown>;
  readonly hold: Promise<unknown>;
  readonly readLog: (path: string) => Promise<string>;
}

type StandInContext = Pick<ServiceContext<unknown, unknown>, 'exec' | 'run'>;

interface StandInService {
  readonly start: (ctx: StandInContext) => Promise<ServiceInstance>;
}

export interface StandInServices {
  // What each service did, in order, for a test to read back.
  readonly calls: readonly string[];

  // Its stop records itself, waits for the stop gate, then fails.
  readonly store: StandInService;

  // It comes up only once the start gate opens, whatever the abort says.
  readonly queue: StandInService;

  // Its stop runs a command through the exec the service started with.
  readonly shelf: StandInService;

  // Its stop throws before it returns a promise.
  readonly till: StandInService;

  // Its stop records each line of the app's log.
  readonly ledger: StandInService;

  // Its `hold` method records itself and settles only once the hold gate opens. Its `watch` method
  // answers the time its signal aborted.
  readonly counter: StandInService;

  // Its start runs `sleep 30` through its exec, whatever the abort says, and records how the
  // command settled.
  readonly press: StandInService;
}

// Services that each stand for one way a real service can behave at a run's start and stop.
export function buildStandInServices(dependencies: StandInDependencies): StandInServices {
  const calls: string[] = [];

  return {
    calls,
    store: {
      start: () =>
        Promise.resolve({
          methods: {},
          stop: async () => {
            calls.push('store');

            await dependencies.stop;

            throw new WringerError('environment', { message: 'The store kept its lock.' });
          },
        }),
    },
    queue: {
      start: async () => {
        await dependencies.start;

        return {
          methods: {},
          stop: () => {
            calls.push('queue');

            return Promise.resolve();
          },
        };
      },
    },
    shelf: {
      start: (ctx) =>
        Promise.resolve({
          methods: {},
          stop: async () => {
            const result = await ctx.exec(['true'], 'read');

            calls.push(`shelf exited ${result.exitCode}`);
          },
        }),
    },
    till: {
      start: () =>
        Promise.resolve({
          methods: {},
          stop: () => {
            throw new WringerError('environment', { message: 'The till jammed.' });
          },
        }),
    },
    ledger: {
      start: (ctx) =>
        Promise.resolve({
          methods: {},
          stop: async () => {
            const log = await dependencies.readLog(ctx.run.childLog('app').path);

            calls.push(...log.trimEnd().split('\n'));
          },
        }),
    },
    counter: {
      start: () =>
        Promise.resolve({
          methods: {
            hold: async () => {
              calls.push('hold');

              await dependencies.hold;

              return null;
            },
            watch: async (_args, signal) => {
              await once(signal, 'abort');

              return { cancelledAtMs: Date.now() };
            },
          },
          stop: () => Promise.resolve(),
        }),
    },
    press: {
      start: async (ctx) => {
        const [command] = await Promise.allSettled([ctx.exec(['sleep', '30'], 'read')]);

        calls.push(`press command ${command.status}`);

        return { methods: {}, stop: () => Promise.resolve() };
      },
    },
  };
}
