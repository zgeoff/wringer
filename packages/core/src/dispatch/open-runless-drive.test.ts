import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { createTempDir } from '@zgeoff/testing/fs';
import { getTarget } from '../registry/get-target.ts';
import { createNodeRepoHost } from '../repo-host/create-node-repo-host.ts';
import { createSecretSet } from '../secrets/create-secret-set.ts';
import { createShopWringer } from '../test-utils/create-shop-wringer.ts';
import { openRunlessDrive } from './open-runless-drive.ts';

function setupTest() {
  const directory = createTempDir('runless-drive').path;
  const wringer = createShopWringer();

  return {
    openDrive: () =>
      openRunlessDrive({
        wringer,
        root: directory,
        stateDir: join(directory, '.wringer'),
        targetName: 'local',
        target: getTarget(wringer, 'local'),
        access: 'read-write',
        hint: 'reproduce it on local',
        feature: null,
        signal: new AbortController().signal,
        now: () => new Date('2026-11-04T10:00:00.000Z'),
        emit: () => {
          // The drive emits nothing here.
        },
        files: createNodeRepoHost(),
        secrets: createSecretSet(),
      }),
  };
}

test('it runs a command through the fenced exec without a run', async () => {
  const ctx = setupTest();
  const drive = ctx.openDrive();

  const result = await drive.ctx.exec(['echo', 'shelf']);

  expect(result.stdout).toBe('shelf\n');
});
