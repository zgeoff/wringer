import { expect, test } from 'bun:test';
import { appendFile, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import { local } from '../host/local.ts';
import { createWringer } from '../registry/create-wringer.ts';
import { createTestSession } from '../test-utils/create-test-session.ts';
import { seedImportWorkspace } from '../test-utils/seed-import-workspace.ts';
import { reportSchema } from '../verdict/report-schema.ts';

async function setupTest() {
  const reportDataSchema = z.looseObject({ report: reportSchema });

  const wringer = createWringer({ name: 'imports' })
    .target('local', { mode: 'attach', access: 'read-write', host: local() })
    .feature(
      {
        name: 'app',
        summary: 'The app',
        entries: ['packages/app/src/main.ts'],
        extra: ['packages/app/journeys/**'],
      },
      {
        name: 'mixed',
        summary: 'Entries and paths together',
        entries: ['packages/app/src/unused.ts'],
        paths: ['packages/mixed/assets/**'],
      },
    )
    .shared('package.json')
    .ignore('packages/lib/src/ignored.ts')
    .build();

  const imports = await createTestSession({ wringer });

  await seedImportWorkspace(imports.repo.root);

  return {
    root: imports.repo.root,
    edit: async (path: string) => {
      await mkdir(dirname(join(imports.repo.root, path)), { recursive: true });
      await writeFile(join(imports.repo.root, path), 'export const edited = 1;\n');
    },
    stageRemoval: async (path: string) => {
      await rm(join(imports.repo.root, path));

      await imports.repo.git('rm', '--quiet', '--cached', path);
    },
    excludeLocally: async (path: string) => {
      await appendFile(join(imports.repo.root, '.git', 'info', 'exclude'), `${path}\n`);
      await writeFile(join(imports.repo.root, path), 'export const local = 1;\n');
    },
    linkDangling: (path: string) => symlink('nowhere', join(imports.repo.root, path)),
    replaceFolderWithFile: async (path: string) => {
      await rm(join(imports.repo.root, path), { recursive: true });
      await writeFile(join(imports.repo.root, path), 'now a file\n');
    },
    remove: (path: string) => rm(join(imports.repo.root, path)),
    readReport: async () => {
      const result = await imports.dispatch(
        wringer,
        ['report'],
        {},
        { ...imports.session, target: 'local' },
      );

      const parsed = reportDataSchema.parse(result.envelope.data);
      const report = parsed.report;

      return {
        changed: report.features
          .filter((feature) => feature.changed)
          .map((feature) => feature.name),
        unmapped: report.unmapped,
      };
    },
  };
}

test('it flags a feature when a file its entry imports through a package subpath changes', async () => {
  const ctx = await setupTest();

  await ctx.edit('packages/lib/src/area.ts');

  const report = await ctx.readReport();

  expect(report).toStrictEqual({ changed: ['app'], unmapped: [] });
});

test('it flags a feature when a file two imports away changes, and counts that file as mapped', async () => {
  const ctx = await setupTest();

  await ctx.edit('packages/lib/src/deep.ts');

  const report = await ctx.readReport();

  expect(report).toStrictEqual({ changed: ['app'], unmapped: [] });
});

test('it leaves a feature alone when a sibling file its entry never imports changes', async () => {
  const ctx = await setupTest();

  await ctx.edit('packages/lib/src/sibling.ts');

  const report = await ctx.readReport();

  expect(report).toStrictEqual({
    changed: [],
    unmapped: ['packages/lib/src/sibling.ts'],
  });
});

test('it flags a feature when a file matched by its extra globs changes', async () => {
  const ctx = await setupTest();

  await ctx.edit('packages/app/journeys/checkout.md');

  const report = await ctx.readReport();

  expect(report).toStrictEqual({ changed: ['app'], unmapped: [] });
});

test('it flags a feature when a file matched by its paths changes beside its entries', async () => {
  const ctx = await setupTest();

  await ctx.edit('packages/mixed/assets/logo.svg');

  const report = await ctx.readReport();

  expect(report).toStrictEqual({ changed: ['mixed'], unmapped: [] });
});

test('it still leaves a changed file out when an ignore glob matches it', async () => {
  const ctx = await setupTest();

  await ctx.edit('packages/lib/src/ignored.ts');

  const report = await ctx.readReport();

  expect(report).toStrictEqual({ changed: [], unmapped: [] });
});

test('it still flags every feature when a shared glob matches the changed file', async () => {
  const ctx = await setupTest();

  await ctx.edit('package.json');

  const report = await ctx.readReport();

  expect(report).toStrictEqual({ changed: ['app', 'mixed'], unmapped: [] });
});

test('it does not call a deleted file unmapped', async () => {
  const ctx = await setupTest();

  await ctx.remove('packages/lib/src/deep.ts');

  const report = await ctx.readReport();

  expect(report).toStrictEqual({ changed: [], unmapped: [] });
});

test('it does not call a staged deletion unmapped', async () => {
  const ctx = await setupTest();

  await ctx.stageRemoval('packages/lib/src/deep.ts');

  const report = await ctx.readReport();

  expect(report).toStrictEqual({ changed: [], unmapped: [] });
});

test('it still calls a dangling symlink unmapped', async () => {
  const ctx = await setupTest();

  await ctx.linkDangling('packages/lib/src/link.ts');

  const report = await ctx.readReport();

  expect(report).toStrictEqual({ changed: [], unmapped: ['packages/lib/src/link.ts'] });
});

test('it reads a folder replaced by a file without failing on the paths under it', async () => {
  const ctx = await setupTest();

  await ctx.replaceFolderWithFile('packages/app/journeys');

  const report = await ctx.readReport();

  expect(report).toStrictEqual({ changed: ['app'], unmapped: ['packages/app/journeys'] });
});

test('it still calls a new file unmapped when .git/info/exclude hides it from git', async () => {
  const ctx = await setupTest();

  await ctx.excludeLocally('packages/lib/src/local-only.ts');

  const report = await ctx.readReport();

  expect(report).toStrictEqual({ changed: [], unmapped: ['packages/lib/src/local-only.ts'] });
});
