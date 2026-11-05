import { expect, test } from 'bun:test';
import { buildShutDownSteps } from './build-shut-down-steps.ts';

test.each([
  { crashReason: null, failures: [], event: { type: 'run-ended' } },
  {
    crashReason: 'the app exited with code 3',
    failures: [],
    event: { type: 'crashed', reason: 'the app exited with code 3' },
  },
  {
    crashReason: null,
    failures: ['leaky/store: locked'],
    event: { type: 'crashed', reason: 'cleanup failed for leaky/store: locked' },
  },
  {
    crashReason: 'the app exited with code 3',
    failures: ['leaky/store: locked'],
    event: {
      type: 'crashed',
      reason: 'the app exited with code 3; cleanup failed for leaky/store: locked',
    },
  },
])(
  '#buildShutDownSteps ends the run with $event.type for crash $crashReason and failures $failures',
  (row) => {
    const steps = buildShutDownSteps({
      crashReason: row.crashReason,
      gaveUpOnStartup: false,
      failures: row.failures,
      at: '2026-11-04T10:00:00.000Z',
    });

    expect(steps.events).toStrictEqual([{ ...row.event, at: '2026-11-04T10:00:00.000Z' }]);
  },
);

test('#buildShutDownSteps answers a failed cleanup with an environment error that names it', () => {
  const steps = buildShutDownSteps({
    crashReason: null,
    gaveUpOnStartup: false,
    failures: ['leaky/store: locked'],
    at: '2026-11-04T10:00:00.000Z',
  });

  expect(steps.failure).toMatchObject({
    code: 'environment',
    message: 'The run ended, and a part may still be up. Cleanup failed for leaky/store: locked',
  });
});

test('#buildShutDownSteps answers a clean stop with no failure', () => {
  const steps = buildShutDownSteps({
    crashReason: 'the app exited with code 3',
    gaveUpOnStartup: false,
    failures: [],
    at: '2026-11-04T10:00:00.000Z',
  });

  expect(steps.failure).toBeNull();
});

test.each([
  { gaveUpOnStartup: false, abortCommands: true },
  { gaveUpOnStartup: true, abortCommands: false },
])(
  '#buildShutDownSteps aborts the service commands: $abortCommands, after giving up on startup: $gaveUpOnStartup',
  (row) => {
    const steps = buildShutDownSteps({
      crashReason: null,
      gaveUpOnStartup: row.gaveUpOnStartup,
      failures: [],
      at: '2026-11-04T10:00:00.000Z',
    });

    expect(steps.abortCommands).toBe(row.abortCommands);
  },
);
