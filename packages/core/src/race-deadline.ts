import { WringerError } from './wringer-error.ts';

// The work's own promise may never settle once its deadline passes, so the deadline settles the
// race with a timeout, including a deadline that passed before the race began.
export async function raceDeadline<T>(work: Promise<T>, deadline: AbortSignal): Promise<T> {
  const aborted = Promise.withResolvers<T>();

  const onAbort = (): void => {
    aborted.reject(new WringerError('timeout'));
  };

  deadline.addEventListener('abort', onAbort, { once: true });

  if (deadline.aborted) {
    onAbort();
  }

  try {
    return await Promise.race([work, aborted.promise]);
  } finally {
    deadline.removeEventListener('abort', onAbort);
  }
}
