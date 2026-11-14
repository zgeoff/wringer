import { expect, test } from 'bun:test';
import invariant from 'tiny-invariant';
import { pickSupervisorOperation } from './pick-supervisor-operation.ts';
import { supervisorServiceName } from './supervisor-request.ts';

test.each([
  { method: 'stop', kind: 'stop' },
  { method: 'status', kind: 'status' },
  { method: 'ping', kind: 'status' },
])("it picks $kind for the supervisor's own $method", (row) => {
  const operation = pickSupervisorOperation(
    { service: supervisorServiceName, method: row.method, args: {} },
    new Map(),
    1_000_000,
  );

  expect(operation).toStrictEqual({ kind: row.kind });
});

test("it picks a call that passes the request's args and the caller's signal to the service method", async () => {
  const services = new Map([
    [
      'shelf',
      {
        methods: {
          count: (args: unknown, signal: AbortSignal) =>
            Promise.resolve({ counted: args, aborted: signal.aborted }),
        },
      },
    ],
  ]);

  const operation = pickSupervisorOperation(
    { service: 'shelf', method: 'count', args: { aisle: 4 } },
    services,
    1_000_000,
  );

  invariant(operation.kind === 'call');

  const result = await operation.call(AbortSignal.abort());

  expect(result).toStrictEqual({ counted: { aisle: 4 }, aborted: true });
});

test.each([
  { name: 'no deadline', deadlineAt: undefined, cancelAfterMs: [] },
  { name: 'a deadline 5 s away', deadlineAt: 1_005_000, cancelAfterMs: [4000] },
  { name: 'a deadline 1 s away', deadlineAt: 1_001_000, cancelAfterMs: [0] },
  { name: 'a deadline that has passed', deadlineAt: 999_000, cancelAfterMs: [0] },
])('it cancels a service call one second before $name', (row) => {
  const services = new Map([['shelf', { methods: { count: () => Promise.resolve(0) } }]]);

  const operation = pickSupervisorOperation(
    { service: 'shelf', method: 'count', args: {}, deadlineAt: row.deadlineAt },
    services,
    1_000_000,
  );

  expect(operation).toStrictEqual({
    kind: 'call',
    cancelAfterMs: row.cancelAfterMs,
    call: expect.any(Function),
  });
});

test.each([
  { name: 'a service the run has not started', service: 'till', method: 'count' },
  { name: 'a method the service lacks', service: 'shelf', method: 'restock' },
  { name: 'a method every object inherits', service: 'shelf', method: 'constructor' },
])('it refuses $name with a usage error', (row) => {
  const services = new Map([['shelf', { methods: { count: () => Promise.resolve(0) } }]]);

  const operation = pickSupervisorOperation(
    { service: row.service, method: row.method, args: {} },
    services,
    1_000_000,
  );

  expect(operation).toStrictEqual({
    kind: 'refuse',
    error: expect.objectContaining({
      code: 'usage',
      message: `The run has no service call ${row.service} ${row.method}.`,
    }),
  });
});
