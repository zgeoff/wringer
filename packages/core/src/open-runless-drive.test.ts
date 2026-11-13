import { expect, onTestFinished, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createNodeRepoHost } from './create-node-repo-host.ts';
import { createSecretSet } from './create-secret-set.ts';
import { getTarget } from './get-target.ts';
import { openRunlessDrive } from './open-runless-drive.ts';
import { createShopWringer } from './test-utils/create-shop-wringer.ts';
import { createTestFolder } from './test-utils/create-test-folder.ts';

async function setupTest() {
  const directory = await createTestFolder(import.meta.dir, 'runless-drive');

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

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
  const ctx = await setupTest();

  const drive = ctx.openDrive();

  const result = await drive.ctx.exec(['echo', 'shelf']);

  expect(result.stdout).toBe('shelf\n');
});
