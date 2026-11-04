import { expect, test } from 'bun:test';
import invariant from 'tiny-invariant';
import { pickSupervisorOperation } from './pick-supervisor-operation.ts';
import { supervisorServiceName } from './supervisor-protocol.ts';

test.each([
  { method: 'stop', kind: 'stop' },
  { method: 'status', kind: 'status' },
  { method: 'ping', kind: 'status' },
])("it picks $kind for the supervisor's own $method", (row) => {
  const operation = pickSupervisorOperation(
    { service: supervisorServiceName, method: row.method, args: {} },
    new Map(),
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
  );

  invariant(operation.kind === 'call');

  const result = await operation.call(AbortSignal.abort());

  expect(result).toStrictEqual({ counted: { aisle: 4 }, aborted: true });
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
  );

  expect(operation).toStrictEqual({
    kind: 'refuse',
    error: expect.objectContaining({
      code: 'usage',
      message: `The run has no service call ${row.service} ${row.method}.`,
    }),
  });
});
