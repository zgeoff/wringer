import { WringerError } from './wringer-error.ts';

export interface PayloadInput {
  readonly data: unknown;
  readonly commandFailure: WringerError | null;
  readonly cursors: Readonly<Record<string, number>> | WringerError;
}

export interface EnvelopePayload {
  readonly data: unknown;
  readonly failure: WringerError | null;
  readonly cursors: Readonly<Record<string, number>>;
}

// The command's own failure leads, and a cursor read that failed after it is the envelope's
// failure. A failed command's envelope carries the data its error gives, such as the doctor's
// results; an internal error's data is its stack, which goes to the run's log instead.
export function pickEnvelopePayload(input: PayloadInput): EnvelopePayload {
  const cursorsFailure = input.cursors instanceof WringerError ? input.cursors : null;
  const cursors = input.cursors instanceof WringerError ? {} : input.cursors;
  const failure = input.commandFailure ?? cursorsFailure;

  if (failure === null) {
    return { data: input.data, failure, cursors };
  }

  return { data: failure.code === 'internal' ? null : failure.data, failure, cursors };
}
