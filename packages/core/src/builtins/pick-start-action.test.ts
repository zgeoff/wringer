import { expect, test } from 'bun:test';
import { pickStartAction } from './pick-start-action.ts';

test.each([
  { status: null, restart: false, ping: null, stop: null, action: 'start' },
  { status: 'ended', restart: false, ping: null, stop: null, action: 'start' },
  { status: 'crashed', restart: true, ping: null, stop: null, action: 'start' },
  { status: 'running', restart: false, ping: null, stop: null, action: 'ping' },
  { status: 'starting', restart: false, ping: null, stop: null, action: 'ping' },
  { status: 'running', restart: false, ping: 'answered', stop: null, action: 'reuse' },
  { status: 'running', restart: true, ping: 'answered', stop: null, action: 'stop' },
  { status: 'starting', restart: false, ping: 'answered', stop: null, action: 'stop' },
  { status: 'running', restart: false, ping: 'gone', stop: null, action: 'mark-crashed' },
  { status: 'starting', restart: false, ping: 'gone', stop: null, action: 'mark-crashed' },
  { status: 'running', restart: true, ping: 'answered', stop: 'answered', action: 'start' },
  { status: 'running', restart: true, ping: 'answered', stop: 'gone', action: 'mark-crashed' },
] as const)(
  'it picks $action for a $status run, restart $restart, ping $ping, stop $stop',
  (row) => {
    expect(
      pickStartAction({
        status: row.status,
        restart: row.restart,
        ping: row.ping,
        stop: row.stop,
      }),
    ).toBe(row.action);
  },
);
