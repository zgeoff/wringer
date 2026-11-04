import { defaultMessageFor } from './error-codes.ts';
import type { ErrorCode } from './error-codes.ts';

export interface WringerErrorDetails {
  readonly message?: string;
  readonly hint?: string;
  readonly data?: unknown;
}

export class WringerError extends Error {
  readonly code: ErrorCode;

  readonly hint: string | undefined;

  readonly data: unknown;

  constructor(code: ErrorCode, details: WringerErrorDetails = {}) {
    super(details.message ?? defaultMessageFor[code]);

    this.name = 'WringerError';
    this.code = code;
    this.hint = details.hint;
    this.data = details.data;
  }
}
