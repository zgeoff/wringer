import { expect, test } from 'bun:test';
import { createStreamWringer } from './create-stream-wringer.ts';

test('it builds the local, box, bulk and dead targets with the stream driver', () => {
  const wringer = createStreamWringer('/srv/triggers');

  expect({
    targets: [...wringer.targets.keys()],
    drivers: wringer.drivers.map((driver) => driver.name),
    modes: [...wringer.targets.values()].map((target) => target.mode),
  }).toStrictEqual({
    targets: ['local', 'box', 'bulk', 'dead'],
    drivers: ['stream'],
    modes: ['launch', 'attach', 'attach', 'attach'],
  });
});
