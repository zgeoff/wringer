import { expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { dispatch } from '@wringer/core';
import type { Wringer } from '@wringer/core';
import { createFakePullRequestHost } from '@wringer/core/test-utils/create-fake-pull-request-host.ts';
import { createFileHostStandIn } from '@wringer/core/test-utils/create-file-host-stand-in.ts';
import { createTestSession } from '@wringer/core/test-utils/create-test-session.ts';
import { updateEnv } from '@zgeoff/testing/helpers';
import invariant from 'tiny-invariant';
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

  // A failed step leaves no verdict, and `publish` then passes with nothing to upload.
  const runStep = async (wringer: Wringer, path: readonly string[], args: unknown = {}) => {
    const result = await run(wringer, path, args);

    invariant(result.envelope.ok, `${path.join(' ')} failed: ${JSON.stringify(result.envelope)}`);
  };

  return {
    registry,

    // Drives one feature's journey on the `local` target and records its verdict.
    verify: async (wringer: Wringer, feature: string) => {
      await runStep(wringer, ['up']);
      await runStep(wringer, ['doctor']);
      await runStep(wringer, ['use'], { feature });
      await runStep(wringer, ['action', 'place-order']);
      await runStep(wringer, ['done']);
    },
    publish: (wringer: Wringer) => run(wringer, ['publish'], { pr: 7 }),
    readBody: () => pullRequests.readStoredBody(7) ?? '',
    writeFiles: async (paths: readonly string[]) => {
      for (const path of paths) {
        await mkdir(dirname(join(shop.repo.root, path)), { recursive: true });
        await writeFile(join(shop.repo.root, path), 'changed\n');
      }
    },
  };
}

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
