import { match } from 'ts-pattern';

export interface CancelState {
  readonly open: boolean;
  readonly failing: boolean;
}

export const initialCancelState: CancelState = { open: false, failing: false };

// `tick` comes at the start and after each wait, `cancelled` and `failed` after each attempt.
export type CancelEvent =
  | { readonly kind: 'tick'; readonly settled: boolean }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed'; readonly message: string };

// `attempt` opens a cancel session when none is open, then sends the cancel through it.
export type CancelEffect =
  | { readonly kind: 'attempt' }
  | { readonly kind: 'report'; readonly message: string }
  | { readonly kind: 'close' }
  | { readonly kind: 'wait' }
  | { readonly kind: 'stop' };

export interface CancelStep {
  readonly state: CancelState;
  readonly effects: readonly CancelEffect[];
}

// A cancel that lands early, or that the server refuses, stops nothing, so the loop tries again on
// a fresh session until the statement settles. It reports the first failure of a run of failures
// only, so a server that refuses for a while is named once.
export function pickCancelStep(state: CancelState, event: CancelEvent): CancelStep {
  return match(event)
    .with({ kind: 'tick', settled: true }, (): CancelStep => {
      const effects: CancelEffect[] = state.open ? [{ kind: 'close' }] : [];

      return { state: { ...state, open: false }, effects: [...effects, { kind: 'stop' }] };
    })
    .with({ kind: 'tick', settled: false }, (): CancelStep => ({
      state: { ...state, open: true },
      effects: [{ kind: 'attempt' }],
    }))
    .with({ kind: 'cancelled' }, (): CancelStep => ({
      state: { ...state, failing: false },
      effects: [{ kind: 'wait' }],
    }))
    .with({ kind: 'failed' }, (failed): CancelStep => {
      const message = `The query could not be cancelled yet, and runs on until it can be: ${failed.message}`;
      const reports: CancelEffect[] = state.failing ? [] : [{ kind: 'report', message }];

      return {
        state: { open: false, failing: true },
        effects: [...reports, { kind: 'close' }, { kind: 'wait' }],
      };
    })
    .exhaustive();
}
