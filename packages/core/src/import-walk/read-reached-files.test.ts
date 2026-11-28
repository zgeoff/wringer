import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createNodeRepoHost } from '../repo-host/create-node-repo-host.ts';
import { createTestRepo } from '../test-utils/create-test-repo.ts';
import { seedImportWorkspace } from '../test-utils/seed-import-workspace.ts';
import { readReachedFiles } from './read-reached-files.ts';

async function setupTest() {
  const repo = await createTestRepo();

  onTestFinished(() => {
    repo.remove();
  });

  await seedImportWorkspace(repo.root);

  return {
    root: repo.root,
    write: async (path: string, text: string) => {
      await mkdir(dirname(join(repo.root, path)), { recursive: true });
      await writeFile(join(repo.root, path), text);
    },
    link: async (name: string, target: string) => {
      await mkdir(join(repo.root, 'node_modules', '@fx'), { recursive: true });
      await symlink(join('..', '..', target), join(repo.root, 'node_modules', '@fx', name));
    },
    read: (entryFiles: readonly string[]) =>
      readReachedFiles(createNodeRepoHost(), { root: repo.root, entryFiles }),
  };
}

test('it reaches a file through a workspace package subpath and the files that file imports', async () => {
  const ctx = await setupTest();
  const result = await ctx.read(['packages/app/src/main.ts']);

  expect(result.reached).toStrictEqual([
    'packages/app/src/aliased.ts',
    'packages/app/src/helper.ts',
    'packages/app/src/main.ts',
    'packages/lib/src/area.ts',
    'packages/lib/src/deep.ts',
  ]);
});

test('it never reaches a sibling file that no import names', async () => {
  const ctx = await setupTest();
  const result = await ctx.read(['packages/app/src/main.ts']);

  expect(result.reached).not.toIncludeAnyMembers([
    'packages/lib/src/sibling.ts',
    'packages/lib/src/index.ts',
    'packages/app/src/unused.ts',
  ]);
});

test('it follows a tsconfig path alias', async () => {
  const ctx = await setupTest();
  const result = await ctx.read(['packages/app/src/main.ts']);

  expect(result.reached).toContain('packages/app/src/aliased.ts');
});

test('it stops at node_modules', async () => {
  const ctx = await setupTest();
  const result = await ctx.read(['packages/app/src/main.ts']);

  expect(result.reached.filter((path) => path.includes('node_modules'))).toStrictEqual([]);
});

test('it warns with the file and line of an import() whose path is not a literal', async () => {
  const ctx = await setupTest();
  const result = await ctx.read(['packages/app/src/main.ts']);

  expect(result.warnings).toStrictEqual([
    'packages/app/src/main.ts:6: an import() with a path that is not a literal, so the walk cannot follow it',
  ]);
});

test('it follows an import() with a literal path, a require() and an export from', async () => {
  const ctx = await setupTest();

  await ctx.write(
    'packages/app/src/entry.ts',
    [
      "export { helper } from './helper.ts';",
      "export const lazy = () => import('./unused.ts');",
      "export const old = require('../../lib/src/sibling.ts');",
      '',
    ].join('\n'),
  );

  const result = await ctx.read(['packages/app/src/entry.ts']);

  expect(result.reached).toStrictEqual([
    'packages/app/src/entry.ts',
    'packages/app/src/helper.ts',
    'packages/app/src/unused.ts',
    'packages/lib/src/sibling.ts',
  ]);
});

test('it resolves a .js specifier to the .ts file beside it', async () => {
  const ctx = await setupTest();

  await ctx.write('packages/app/src/entry.ts', "import './helper.js';\n");

  const result = await ctx.read(['packages/app/src/entry.ts']);

  expect(result.reached).toContain('packages/app/src/helper.ts');
});

test('it keeps an entry that is gone, and reaches nothing from it', async () => {
  const ctx = await setupTest();
  const result = await ctx.read(['packages/app/src/gone.ts']);

  expect(result).toStrictEqual({ reached: ['packages/app/src/gone.ts'], warnings: [] });
});

test('it follows the require condition of a package for require() and the import condition for import', async () => {
  const ctx = await setupTest();

  await ctx.write(
    'packages/dual/package.json',
    JSON.stringify({
      name: '@fx/dual',
      exports: { '.': { require: './src/common.cjs', import: './src/module.ts' } },
    }),
  );

  await ctx.write('packages/dual/src/common.cjs', 'module.exports = 1;\n');
  await ctx.write('packages/dual/src/module.ts', 'export const dual = 1;\n');
  await ctx.write('packages/app/src/only-import.ts', "import '@fx/dual';\n");
  await ctx.write('packages/app/src/only-require.ts', "require('@fx/dual');\n");
  await ctx.link('dual', 'packages/dual');

  const imported = await ctx.read(['packages/app/src/only-import.ts']);
  const required = await ctx.read(['packages/app/src/only-require.ts']);

  expect({ imported: imported.reached, required: required.reached }).toStrictEqual({
    imported: ['packages/app/src/only-import.ts', 'packages/dual/src/module.ts'],
    required: ['packages/app/src/only-require.ts', 'packages/dual/src/common.cjs'],
  });
});

test('it tries .tsx before .ts, as Bun does', async () => {
  const ctx = await setupTest();

  await ctx.write('packages/app/src/route.ts', '');
  await ctx.write('packages/app/src/route.tsx', '');
  await ctx.write('packages/app/src/entry.ts', "import './route';\n");

  const result = await ctx.read(['packages/app/src/entry.ts']);

  expect(result.reached).toStrictEqual(['packages/app/src/entry.ts', 'packages/app/src/route.tsx']);
});

test.each([
  {
    kind: 'import',
    files: ['route.ts', 'route.jsx'],
    expected: 'route.jsx',
    code: "import './route';\n",
  },
  {
    kind: 'require',
    files: ['route.mts', 'route.cts'],
    expected: 'route.cts',
    code: "require('./route');\n",
  },
])('it picks $expected over $files for an extensionless $kind, as Bun does', async (row) => {
  const ctx = await setupTest();

  await Promise.all(row.files.map((file) => ctx.write(`packages/app/src/${file}`, '')));
  await ctx.write('packages/app/src/entry.ts', row.code);

  const result = await ctx.read(['packages/app/src/entry.ts']);

  expect(result.reached).toStrictEqual([
    'packages/app/src/entry.ts',
    `packages/app/src/${row.expected}`,
  ]);
});
