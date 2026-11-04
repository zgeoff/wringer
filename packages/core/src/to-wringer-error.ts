import { WringerError } from './wringer-error.ts';

// A thrown value that is not a WringerError is a bug in wringer or the repo's code: it becomes the
// code `internal`, and its stack travels in the error's data to the run's log.
export function toWringerError(error: unknown): WringerError {
  if (error instanceof WringerError) {
    return error;
  }

  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return new WringerError('timeout');
  }

  const stack = error instanceof Error ? (error.stack ?? error.message) : String(error);

  return new WringerError('internal', {
    message: `wringer failed with an internal error: ${error instanceof Error ? error.message : String(error)}`,
    data: { stack },
  });
}
