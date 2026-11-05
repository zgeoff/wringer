import { expect, test } from 'bun:test';
import { createHttpWringer } from './create-http-wringer.ts';

test('it registers its four targets, the http command and the sneak-order action', () => {
  const wringer = createHttpWringer('http://127.0.0.1:9/');

  expect({
    targets: [...wringer.targets.keys()],
    commands: ['http request', 'action sneak-order'].map((path) => wringer.commands.has(path)),
  }).toStrictEqual({ targets: ['local', 'prod', 'broken', 'bare'], commands: [true, true] });
});
