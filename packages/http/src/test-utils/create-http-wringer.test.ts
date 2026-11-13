import { expect, test } from 'bun:test';
import { createHttpWringer } from './create-http-wringer.ts';

test('it registers its five targets, the http command and its two actions', () => {
  const wringer = createHttpWringer('http://127.0.0.1:9/');

  expect({
    targets: [...wringer.targets.keys()],
    commands: ['http request', 'action sneak-order', 'action send-auth'].map((path) =>
      wringer.commands.has(path),
    ),
  }).toStrictEqual({
    targets: ['local', 'prod', 'broken', 'bare', 'inherited'],
    commands: [true, true, true],
  });
});
