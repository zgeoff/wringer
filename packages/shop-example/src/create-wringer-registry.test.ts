import { expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { dispatch, reportSchema } from '@wringer/core';
import { createTestSession } from '@wringer/core/test-utils/create-test-session.ts';
import { updateEnv } from '@zgeoff/testing/helpers';
import { z } from 'zod';
import { createShopRegistry } from './create-shop-registry.ts';
import { createWringerRegistry } from './create-wringer-registry.ts';

async function setupTest() {
  const registry = createWringerRegistry();

  const shop = await createTestSession({ parent: import.meta.dir, wringer: registry });

  return {
    registry,
    session: shop.session,
    root: shop.repo.root,
    writeFiles: async (paths: readonly string[]) => {
      for (const path of paths) {
        await mkdir(dirname(join(shop.repo.root, path)), { recursive: true });
        await writeFile(join(shop.repo.root, path), 'changed\n');
      }
    },
    readTrackedFiles: async () => {
      const child = Bun.spawn(['git', 'ls-files', '-z'], {
        cwd: join(import.meta.dir, '..', '..', '..'),
        stdout: 'pipe',
      });

      const listing = await new Response(child.stdout).text();

      return listing.split('\0').filter((path) => path !== '');
    },
    readReport: async () => {
      const result = await dispatch(registry, ['report'], {}, { ...shop.session, target: 'local' });

      return z.strictObject({ report: reportSchema }).loose().parse(result.envelope.data).report;
    },
  };
}

test('it lists the same secrets, targets, commands and doctor checks in the wringer and shop registries', () => {
  const wringer = createWringerRegistry();
  const shop = createShopRegistry();

  const describeRegistry = (registry: typeof wringer) => ({
    secrets: registry.secrets,
    targets: [...registry.targets.entries()].map(([name, target]) => [
      name,
      target.mode,
      target.access,
    ]),
    drivers: registry.drivers.map((driver) => driver.name),
    commands: [...registry.commands.keys()],
    checks: registry.checks.map((check) => check.name),
  });

  expect(describeRegistry(wringer)).toStrictEqual(describeRegistry(shop));
  expect(wringer.commands.has('action place-order')).toBeTrue();
  expect(wringer.checks.map((check) => check.name)).toStrictEqual(['orders-api']);
});

test('it names the wringer registry and registers one feature for each package', () => {
  const registry = createWringerRegistry();

  expect({
    name: registry.name,
    features: registry.features.map((feature) => feature.name),
  }).toStrictEqual({
    name: 'wringer',
    features: [
      'browser-driver',
      'http-driver',
      'db-driver',
      'stream-driver',
      'terminal-driver',
      'core',
      'cli',
      'guide',
    ],
  });
});

test('it names `features` as the cli command and `guide` as the guide command, and no other', () => {
  const registry = createWringerRegistry();

  expect(
    registry.features
      .filter((feature) => feature.commands !== undefined)
      .map((feature) => [feature.name, feature.commands]),
  ).toStrictEqual([
    ['cli', ['features']],
    ['guide', ['guide']],
  ]);
});

test('it leaves every verdict fresh after a change only to a test file or a README', async () => {
  const ctx = await setupTest();

  await ctx.writeFiles(['packages/core/src/run-thing.test.ts', 'packages/http/README.md']);

  const report = await ctx.readReport();

  expect(report.features.map((feature) => feature.changed)).toStrictEqual(
    report.features.map(() => false),
  );

  expect(report.unmapped).toStrictEqual([]);
  expect(report.complete).toBeTrue();
});

test('it marks the core feature changed after a change to a core source file', async () => {
  const ctx = await setupTest();

  await ctx.writeFiles(['packages/core/src/run-thing.ts']);

  const report = await ctx.readReport();

  expect(
    report.features.filter((feature) => feature.changed).map((feature) => feature.name),
  ).toStrictEqual(['core']);
});

test('it maps every tracked file to a feature, a shared glob or an ignore glob', async () => {
  const ctx = await setupTest();
  const tracked = await ctx.readTrackedFiles();

  await ctx.writeFiles(tracked);

  const report = await ctx.readReport();

  expect(report.unmapped).toStrictEqual([]);
});

test('it marks every feature changed after a change only to a shared file', async () => {
  const ctx = await setupTest();

  await ctx.writeFiles(['package.json']);

  const report = await ctx.readReport();

  expect({
    changed: report.features.map((feature) => feature.changed),
    complete: report.complete,
  }).toStrictEqual({ changed: report.features.map(() => true), complete: false });
});

test('it uploads the evidence of the local target and keeps the demo target local', () => {
  const registry = createWringerRegistry();

  expect(
    [...registry.targets.entries()].map(([name, target]) => [name, target.evidence ?? 'local']),
  ).toStrictEqual([
    ['local', 'upload'],
    ['demo', 'local'],
  ]);
});

test('it keeps the evidence of every shop registry target local and registers no uploader', () => {
  const registry = createShopRegistry();

  expect({
    evidence: [...registry.targets.values()].map((target) => target.evidence ?? 'local'),
    uploader: registry.hooks.upload,
  }).toStrictEqual({ evidence: ['local', 'local'], uploader: undefined });
});

test('it needs neither upload variable for a command that never uploads', async () => {
  const ctx = await setupTest();

  updateEnv('VERIFY_UPLOAD_URL', undefined);
  updateEnv('VERIFY_UPLOAD_TOKEN', undefined);

  const result = await dispatch(ctx.registry, ['report'], {}, { ...ctx.session, target: 'local' });

  expect(result.envelope.ok).toBeTrue();
});
