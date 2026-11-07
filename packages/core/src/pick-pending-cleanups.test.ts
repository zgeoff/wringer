import { expect, test } from 'bun:test';
import { pickPendingCleanups } from './pick-pending-cleanups.ts';

test.each([
  {
    name: 'nothing when nothing came up',
    launched: false,
    serviceKeys: [],
    stopping: [],
    pending: { app: [], services: [] },
  },
  {
    name: 'the app and each service when none is stopping',
    launched: true,
    serviceKeys: ['leaky/store', 'tidy/shelf'],
    stopping: [],
    pending: { app: ['app'], services: ['leaky/store', 'tidy/shelf'] },
  },
  {
    name: 'only the service that came up after a first stop',
    launched: true,
    serviceKeys: ['leaky/store', 'tardy/queue'],
    stopping: ['app', 'leaky/store'],
    pending: { app: [], services: ['tardy/queue'] },
  },
  {
    name: 'the services of an attached target with no app',
    launched: false,
    serviceKeys: ['leaky/store'],
    stopping: [],
    pending: { app: [], services: ['leaky/store'] },
  },
] as const)('#pickPendingCleanups picks $name', (row) => {
  const pending = pickPendingCleanups({
    launched: row.launched,
    serviceKeys: row.serviceKeys,
    stopping: new Set(row.stopping),
  });

  expect(pending).toStrictEqual(row.pending);
});
