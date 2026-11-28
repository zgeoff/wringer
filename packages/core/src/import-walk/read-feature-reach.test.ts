import { expect, onTestFinished, test } from 'bun:test';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createNodeRepoHost } from '../repo-host/create-node-repo-host.ts';
import { createTestRepo } from '../test-utils/create-test-repo.ts';
import { seedImportWorkspace } from '../test-utils/seed-import-workspace.ts';
import { readFeatureReach } from './read-feature-reach.ts';

async function setupTest() {
  const repo = await createTestRepo();

  onTestFinished(() => {
    repo.remove();
  });

  await seedImportWorkspace(repo.root);

  const sourcesRead: string[] = [];
  const node = createNodeRepoHost();

  const host = {
    ...node,
    readText: (path: string) => {
      sourcesRead.push(path);

      return node.readText(path);
    },
  };

  const features = [{ name: 'app', entries: ['packages/app/src/main.ts'] }];

  return {
    root: repo.root,
    git: repo.git,
    sourcesRead,
    read: () => readFeatureReach(host, { root: repo.root, stateDir: '.wringer', features }),
    edit: (path: string, text: string) => appendFile(join(repo.root, path), text),
  };
}

test('it reads a feature with no entries as no reach, and parses nothing', async () => {
  const ctx = await setupTest();

  const reach = await readFeatureReach(createNodeRepoHost(), {
    root: ctx.root,
    stateDir: '.wringer',
    features: [{ name: 'app', entries: [] }],
  });

  expect(reach.size).toBe(0);
});

test('it parses no source on a second read of the same tree', async () => {
  const ctx = await setupTest();

  await ctx.read();

  const readsAfterFirst = ctx.sourcesRead.length;

  await ctx.read();

  expect({
    first: readsAfterFirst > 0,
    extra: ctx.sourcesRead.length - readsAfterFirst,
  }).toStrictEqual({
    first: true,
    extra: 0,
  });
});

test('it returns the warnings of the walk from the saved copy', async () => {
  const ctx = await setupTest();
  const first = await ctx.read();
  const second = await ctx.read();

  expect({ first: first.get('app')?.warnings.length, second: second.get('app') }).toStrictEqual({
    first: 1,
    second: first.get('app'),
  });
});

test('it walks again when an uncommitted edit adds an import', async () => {
  const ctx = await setupTest();

  await ctx.read();
  await ctx.edit('packages/app/src/main.ts', "import './unused.ts';\n");

  const reach = await ctx.read();

  expect(reach.get('app')?.reached).toContain('packages/app/src/unused.ts');
});

test('it walks again after a commit', async () => {
  const ctx = await setupTest();

  await ctx.read();
  await ctx.edit('packages/app/src/main.ts', "import './unused.ts';\n");
  await ctx.git('commit', '--quiet', '--all', '-m', 'import unused');

  const readsBefore = ctx.sourcesRead.length;

  const reach = await ctx.read();

  expect({
    reached: reach.get('app')?.reached.includes('packages/app/src/unused.ts'),
    walked: ctx.sourcesRead.length > readsBefore,
  }).toStrictEqual({ reached: true, walked: true });
});
