import { readFile } from 'node:fs/promises';
import type { ServiceContext, ServiceInstance } from '../src/types.ts';
import { WringerError } from '../src/wringer-error.ts';

export interface StandInGates {
  readonly stop: Promise<unknown>;
  readonly start: Promise<unknown>;
  readonly hold: Promise<unknown>;
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

  // Its `hold` method records itself and settles only once the hold gate opens.
  readonly counter: StandInService;
}

// Services that each stand for one way a real service can behave at a run's start and stop.
export function buildStandInServices(gates: StandInGates): StandInServices {
  const calls: string[] = [];

  return {
    calls,
    store: {
      start: () =>
        Promise.resolve({
          methods: {},
          stop: async () => {
            calls.push('store');

            await gates.stop;

            throw new WringerError('environment', { message: 'The store kept its lock.' });
          },
        }),
    },
    queue: {
      start: async () => {
        await gates.start;

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
            const log = await readFile(ctx.run.childLog('app').path, 'utf8');

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

              await gates.hold;

              return null;
            },
          },
          stop: () => Promise.resolve(),
        }),
    },
  };
}
