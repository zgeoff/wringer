import { WringerError } from '@wringer/core';
import { errors } from 'playwright-core';
import { z } from 'zod';

// Playwright reports a missing element as a timeout and anything else as a plain error; both reach
// the caller as one of the envelope's error codes.
export function toPageError(error: unknown): unknown {
  if (error instanceof WringerError || error instanceof z.ZodError) {
    return error;
  }

  const message = error instanceof Error ? error.message.split('\n')[0] : String(error);

  if (error instanceof errors.TimeoutError) {
    return new WringerError('timeout', {
      message: `The browser gave up: ${message}`,
      hint: 'Run `browser snapshot` to see the page as it is now.',
    });
  }

  return new WringerError('environment', { message: `The browser failed: ${message}` });
}
