export const errorCodes = [
  'check-failed',
  'usage',
  'read-only',
  'doctor-required',
  'not-running',
  'target-not-allowed',
  'environment',
  'internal',
  'timeout',
] as const;

export type ErrorCode = (typeof errorCodes)[number];

export type ExitCode = 0 | 1 | 2 | 3 | 4 | 5;

export const exitCodeFor = {
  'check-failed': 1,
  usage: 2,
  'read-only': 3,
  'doctor-required': 3,
  'not-running': 3,
  'target-not-allowed': 3,
  environment: 4,
  internal: 4,
  timeout: 5,
} as const satisfies Readonly<Record<ErrorCode, ExitCode>>;

export const defaultMessageFor = {
  'check-failed': 'A check failed.',
  usage: 'The command or its arguments are not valid.',
  'read-only': 'The target refused a write.',
  'doctor-required': 'The doctor has not passed on this run.',
  'not-running': 'The target has no running run.',
  'target-not-allowed': 'The command does not run on this target.',
  environment: 'The environment failed.',
  internal: 'wringer failed with an internal error.',
  timeout: 'The command ran past its deadline.',
} as const satisfies Readonly<Record<ErrorCode, string>>;
