import { expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { dispatch, reportSchema } from '@wringer/core';
import type { Wringer } from '@wringer/core';
import { createFakePullRequestHost } from '@wringer/core/test-utils/create-fake-pull-request-host.ts';
import { createFileHostStandIn } from '@wringer/core/test-utils/create-file-host-stand-in.ts';
import { createTestSession } from '@wringer/core/test-utils/create-test-session.ts';
import { updateEnv } from '@zgeoff/testing/helpers';
import { z } from 'zod';
import { createShopRegistry } from './create-shop-registry.ts';
import { createWringerRegistry } from './create-wringer-registry.ts';

async function setupTest() {
  const registry = createWringerRegistry();

  const shop = await createTestSession({ parent: import.meta.dir, wringer: registry });

  const pullRequests = createFakePullRequestHost([
    {
      number: 7,
      url: 'https://github.example/acme/wringer/pull/7',
      body: 'Adds the order log.\n',
      baseBranch: 'main',
      state: 'open',
      branch: 'main',
    },
  ]);

  const run = (wringer: Wringer, path: readonly string[], args: unknown = {}) =>
    dispatch(wringer, path, args, { ...shop.session, pullRequests, target: 'local' });

  return {
    registry,
    session: shop.session,

    // Drives one feature's journey on the `local` target and records its verdict.
    verify: async (wringer: Wringer, feature: string) => {
      await run(wringer, ['up']);
      await run(wringer, ['doctor']);
      await run(wringer, ['use'], { feature });
      await run(wringer, ['action', 'place-order']);
      await run(wringer, ['done']);
    },
    publish: (wringer: Wringer) => run(wringer, ['publish'], { pr: 7 }),
    readBody: () => pullRequests.readStoredBody(7) ?? '',
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

test('#publish links the evidence of a verdict on local to the file host, with the token and the registry label', async () => {
  const token = 'planted-upload-token';
  const host = createFileHostStandIn({ token });

  const ctx = await setupTest();

  updateEnv('VERIFY_UPLOAD_URL', host.url);
  updateEnv('VERIFY_UPLOAD_TOKEN', token);

  await ctx.writeFiles(['packages/http/src/send-request.ts']);
  await ctx.verify(ctx.registry, 'http-driver');

  const result = await ctx.publish(ctx.registry);

  expect({
    ok: result.envelope.ok,
    links: ctx.readBody().includes(`https://${host.host}/`),
    authorizations: new Set(host.uploads.map((upload) => upload.authorization)),
    labels: new Set(host.uploads.map((upload) => upload.label)),
  }).toStrictEqual({
    ok: true,
    links: true,
    authorizations: new Set([`Bearer ${token}`]),
    labels: new Set(['wringer/http-driver']),
  });
});

test('#publish keeps the evidence of a shop registry verdict local and uploads nothing', async () => {
  const token = 'planted-upload-token';
  const host = createFileHostStandIn({ token });

  const ctx = await setupTest();

  const registry = createShopRegistry();

  updateEnv('VERIFY_UPLOAD_URL', host.url);
  updateEnv('VERIFY_UPLOAD_TOKEN', token);

  await ctx.writeFiles(['packages/shop-example/src/shop-app.ts']);
  await ctx.verify(registry, 'list-orders');

  const result = await ctx.publish(registry);

  expect({
    ok: result.envelope.ok,
    links: ctx.readBody().includes(`https://${host.host}/`),
    uploads: host.uploads.length,
  }).toStrictEqual({ ok: true, links: false, uploads: 0 });
});

test('it needs neither upload variable for a command that never uploads', async () => {
  const ctx = await setupTest();

  updateEnv('VERIFY_UPLOAD_URL', undefined);
  updateEnv('VERIFY_UPLOAD_TOKEN', undefined);

  const result = await dispatch(ctx.registry, ['report'], {}, { ...ctx.session, target: 'local' });

  expect(result.envelope.ok).toBeTrue();
});
