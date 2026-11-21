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

  // Playwright words these as plain errors, so the message is the only thing to tell them apart.
  if (message?.includes('strict mode violation') === true) {
    return new WringerError('usage', {
      message: `More than one element matches: ${message}`,
      hint: 'Run `browser snapshot` and pass one element by --ref.',
    });
  }

  if (message?.includes('did not change its state') === true) {
    return new WringerError('check-failed', {
      message: `The control did not change: ${message}`,
      hint: 'Run `browser snapshot` to see the control as it is now.',
    });
  }

  if (message?.includes('Unknown key') === true) {
    return new WringerError('usage', {
      message: `The browser does not know that key: ${message}`,
      hint: 'Pass a key in Playwright syntax, such as Enter, Tab or Control+A.',
    });
  }

  return new WringerError('environment', { message: `The browser failed: ${message}` });
}
