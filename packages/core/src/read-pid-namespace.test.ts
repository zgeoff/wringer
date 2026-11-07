import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readPIDNamespace } from './read-pid-namespace.ts';

function setupTest() {
  return {
    // A child shares the test's PID namespace, and `readlink` prints its link as `pid:[<id>]`.
    readNamespaceLink: () => Bun.spawnSync(['readlink', '/proc/self/ns/pid']).stdout.toString(),
    readPIDNamespace,
  };
}

test.skipIf(!existsSync('/proc/self/ns/pid'))(
  'it reads the id of the PID namespace that /proc names',
  () => {
    const ctx = setupTest();

    expect(`pid:[${ctx.readPIDNamespace()}]\n`).toBe(ctx.readNamespaceLink());
  },
);

test.skipIf(existsSync('/proc/self/ns/pid'))('it reads host where the system has no /proc', () => {
  const ctx = setupTest();

  expect(ctx.readPIDNamespace()).toBe('host');
});
