import { expect, onTestFinished, test } from 'bun:test';
import { createActor } from 'xstate';
import { canMoveSource, pickSourcePhase, sourcePhaseMachine } from './source-phase-machine.ts';
import type { SourceEvent } from './source-phase-machine.ts';

function setupTest() {
  const source = createActor(sourcePhaseMachine);

  source.start();

  onTestFinished(() => {
    source.stop();
  });

  return {
    send: (event: SourceEvent) => {
      source.send(event);
    },
    readContext: () => source.getSnapshot().context,
  };
}

test('#sourcePhaseMachine keeps why the reading ended once the source exits', () => {
  const ctx = setupTest();

  ctx.send({ type: 'exit', detail: 'exit code 0' });

  expect(ctx.readContext()).toStrictEqual({
    phase: 'exited',
    details: { reading: 'exit code 0', write: null },
  });
});

test('#sourcePhaseMachine keeps the first reason when a refused event follows it', () => {
  const ctx = setupTest();

  ctx.send({ type: 'exit', detail: 'exit code 0' });
  ctx.send({ type: 'fail', detail: 'The pipe broke.' });

  expect(ctx.readContext()).toStrictEqual({
    phase: 'exited',
    details: { reading: 'exit code 0', write: null },
  });
});

test('#sourcePhaseMachine clears the write failure once a write recovers', () => {
  const ctx = setupTest();

  ctx.send({ type: 'write-failed', detail: 'The disk is full.' });
  ctx.send({ type: 'write-recovered', detail: null });

  expect(ctx.readContext()).toStrictEqual({
    phase: 'running',
    details: { reading: null, write: null },
  });
});

test.each([
  { from: 'running', to: 'exited', allowed: true },
  { from: 'running', to: 'failed', allowed: true },
  { from: 'running', to: 'running-unwritten', allowed: true },
  { from: 'running-unwritten', to: 'running', allowed: true },
  { from: 'running-unwritten', to: 'exited-unwritten', allowed: true },
  { from: 'exited-unwritten', to: 'exited', allowed: true },
  { from: 'exited', to: 'failed', allowed: false },
  { from: 'exited', to: 'running', allowed: false },
  { from: 'exited-unwritten', to: 'running', allowed: false },
  { from: 'failed', to: 'exited', allowed: false },
  { from: 'failed', to: 'running', allowed: false },
  { from: 'failed-unwritten', to: 'exited', allowed: false },
] as const)('#canMoveSource answers $allowed for $from to $to', (row) => {
  expect(canMoveSource(row.from, row.to)).toBe(row.allowed);
});

test.each([
  { phase: 'running', event: 'exit', next: 'exited' },
  { phase: 'running', event: 'write-failed', next: 'running-unwritten' },
  { phase: 'running-unwritten', event: 'exit', next: 'exited-unwritten' },
  { phase: 'exited-unwritten', event: 'write-recovered', next: 'exited' },
  { phase: 'failed-unwritten', event: 'write-recovered', next: 'failed' },
  { phase: 'failed', event: 'exit', next: 'failed' },
  { phase: 'exited', event: 'fail', next: 'exited' },
] as const)('#pickSourcePhase moves $phase on $event to $next', (row) => {
  expect(pickSourcePhase(row.phase, row.event)).toBe(row.next);
});
