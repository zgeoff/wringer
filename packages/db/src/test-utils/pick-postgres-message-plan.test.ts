import { expect, test } from 'bun:test';
import { pickPostgresMessagePlan } from './pick-postgres-message-plan.ts';

test.each([
  {
    name: 'a startup that names its application',
    connection: { applicationName: null, statement: '', hanging: false },
    refusals: 0,
    message: { type: 'startup', body: new TextEncoder().encode('application_name\0shop\0\0') },
    outcome: {
      connection: { applicationName: 'shop', statement: '', hanging: false },
      refusals: 0,
      replies: ['R', 'Z'],
      close: false,
    },
  },
  {
    name: 'the startup of a cancel connection while refusals are left',
    connection: { applicationName: null, statement: '', hanging: false },
    refusals: 1,
    message: {
      type: 'startup',
      body: new TextEncoder().encode('application_name\0shop-cancel\0\0'),
    },
    outcome: {
      connection: { applicationName: 'shop-cancel', statement: '', hanging: false },
      refusals: 0,
      replies: ['E'],
      close: true,
    },
  },
  {
    name: 'the startup of a cancel connection once no refusals are left',
    connection: { applicationName: null, statement: '', hanging: false },
    refusals: 0,
    message: {
      type: 'startup',
      body: new TextEncoder().encode('application_name\0shop-cancel\0\0'),
    },
    outcome: {
      connection: { applicationName: 'shop-cancel', statement: '', hanging: false },
      refusals: 0,
      replies: ['R', 'Z'],
      close: false,
    },
  },
  {
    name: 'the execute of a pg_sleep statement',
    connection: { applicationName: 'shop', statement: 'select pg_sleep(60)', hanging: false },
    refusals: 0,
    message: { type: 'E', body: new Uint8Array() },
    outcome: {
      connection: { applicationName: 'shop', statement: 'select pg_sleep(60)', hanging: true },
      refusals: 0,
      replies: [],
      close: false,
    },
  },
  {
    name: 'a cancel of the hanging statement of this application',
    connection: { applicationName: 'shop', statement: 'select pg_sleep(60)', hanging: true },
    refusals: 0,
    message: { type: 'cancel', body: new TextEncoder().encode('shop') },
    outcome: {
      connection: { applicationName: 'shop', statement: 'select pg_sleep(60)', hanging: false },
      refusals: 0,
      replies: ['E', 'Z'],
      close: false,
    },
  },
  {
    name: 'a cancel of another application',
    connection: { applicationName: 'shop', statement: 'select pg_sleep(60)', hanging: true },
    refusals: 0,
    message: { type: 'cancel', body: new TextEncoder().encode('till') },
    outcome: {
      connection: { applicationName: 'shop', statement: 'select pg_sleep(60)', hanging: true },
      refusals: 0,
      replies: [],
      close: false,
    },
  },
  {
    name: 'a terminate',
    connection: { applicationName: 'shop', statement: '', hanging: false },
    refusals: 0,
    message: { type: 'X', body: new Uint8Array() },
    outcome: {
      connection: { applicationName: 'shop', statement: '', hanging: false },
      refusals: 0,
      replies: [],
      close: true,
    },
  },
])('it answers $name', (row) => {
  const plan = pickPostgresMessagePlan(row.connection, row.refusals, row.message);

  const replyTypes: readonly string[] = plan.replies.map((reply) =>
    String.fromCodePoint(reply[0] ?? 0),
  );

  expect({
    connection: plan.connection,
    refusals: plan.cancelRefusalsLeft,
    replies: replyTypes,
    close: plan.close,
  }).toStrictEqual(row.outcome);
});

test('it records a Parse message as an extended-protocol statement and keeps its text', () => {
  const plan = pickPostgresMessagePlan(
    { applicationName: 'shop', statement: '', hanging: false },
    0,
    { type: 'P', body: new TextEncoder().encode('\0select 1\0\0\0') },
  );

  expect({ statements: plan.statements, statement: plan.connection.statement }).toStrictEqual({
    statements: [{ protocol: 'extended', sql: 'select 1' }],
    statement: 'select 1',
  });
});
