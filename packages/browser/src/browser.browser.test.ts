import { expect, onTestFinished, test } from 'bun:test';
import { join } from 'node:path';
import { dispatch, readText } from '@wringer/core';
import { waitFor } from '@zgeoff/testing/helpers';
import invariant from 'tiny-invariant';
import { createTestSession } from '../../core/test-utils/create-test-session.ts';
import { createBrowserWringer } from '../test-utils/create-browser-wringer.ts';
import { createShopPageServer } from '../test-utils/create-shop-page-server.ts';
import { snapshotSchema } from './page-service-contract.ts';

async function setupTest() {
  const server = createShopPageServer();

  onTestFinished(() => server.stop());

  const wringer = createBrowserWringer(server.url);

  const shop = await createTestSession({ parent: import.meta.dir, wringer });

  return {
    root: shop.repo.root,
    posts: server.posts,
    pageLoads: server.pageLoads,
    revealRestock: server.revealRestock,
    run: (target: string, path: readonly string[], args: unknown = {}) =>
      dispatch(wringer, path, args, { ...shop.session, target }),
    runWithin: (target: string, path: readonly string[], args: unknown, timeoutMs: number) =>
      dispatch(wringer, path, args, { ...shop.session, target, timeoutMs }),
  };
}

test('it opens a page and prints its snapshot with refs, kept as evidence', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['attach']);
  await ctx.run('local', ['doctor']);
  await ctx.run('local', ['browser', 'goto'], { path: '/' });

  const result = await ctx.run('local', ['browser', 'snapshot']);

  const evidencePath = result.envelope.evidence[0]?.path ?? '';

  const evidence = await readText(join(ctx.root, evidencePath));

  expect({ data: result.envelope.data, evidence }).toStrictEqual({
    data: {
      url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/$/u),
      title: 'Shop',
      snapshot: expect.stringContaining('button "Place order" [ref='),
    },
    evidence: expect.stringContaining('heading "Shop" [level=1]'),
  });
});

test('it clicks an element by its ref on a target that may write', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['attach']);
  await ctx.run('local', ['doctor']);
  await ctx.run('local', ['browser', 'goto'], { path: '/' });

  const snapshot = await ctx.run('local', ['browser', 'snapshot']);

  const printed = snapshotSchema.parse(snapshot.envelope.data).snapshot;
  const ref = /button "Place order" \[ref=(?<ref>e\d+)\]/u.exec(printed)?.groups?.['ref'];

  const result = await ctx.run('local', ['browser', 'click'], { ref });

  expect({ exitCode: result.exitCode, posts: ctx.posts }).toStrictEqual({
    exitCode: 0,
    posts: ['/api/orders'],
  });
});

test('it types into a field by role and name', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['attach']);
  await ctx.run('local', ['doctor']);
  await ctx.run('local', ['browser', 'goto'], { path: '/' });

  await ctx.run('local', ['browser', 'type'], {
    role: 'textbox',
    name: 'Email',
    value: 'buyer@shop.example',
  });

  const result = await ctx.run('local', ['browser', 'snapshot']);

  expect(result.envelope.data).toStrictEqual(
    expect.objectContaining({
      snapshot: expect.stringMatching(/textbox "Email" .*\[ref=e\d+\]: buyer@shop\.example/u),
    }),
  );
});

test('it refuses a click on a read-only target with exit code 3 and the target hint', async () => {
  const ctx = await setupTest();

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);
  await ctx.run('prod', ['browser', 'goto'], { path: '/' });

  const result = await ctx.run('prod', ['browser', 'click'], {
    role: 'button',
    name: 'Place order',
  });

  expect({
    exitCode: result.exitCode,
    error: result.envelope.error,
    posts: ctx.posts,
  }).toStrictEqual({
    exitCode: 3,
    error: {
      code: 'read-only',
      message: '`browser click` is a write, and target prod is read-only.',
      hint: 'prod is read-only: place the order on local.',
    },
    posts: [],
  });
});

test('it refuses a click inside an action that declared a read, at the client call', async () => {
  const ctx = await setupTest();

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);

  const result = await ctx.run('prod', ['action', 'sneak-order']);

  expect({
    exitCode: result.exitCode,
    error: result.envelope.error,
    posts: ctx.posts,
  }).toStrictEqual({
    exitCode: 3,
    error: {
      code: 'read-only',
      message: 'click on button "Place order" is a write, and the target is read-only.',
      hint: 'prod is read-only: place the order on local.',
    },
    posts: [],
  });
});

test('it refuses a goto to a script URL inside an action, with a usage error', async () => {
  const ctx = await setupTest();

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);

  const result = await ctx.run('prod', ['action', 'script-order']);

  expect({
    exitCode: result.exitCode,
    code: result.envelope.error?.code,
    posts: ctx.posts,
  }).toStrictEqual({ exitCode: 2, code: 'usage', posts: [] });
});

test('it clicks the element a read-only target grants', async () => {
  const ctx = await setupTest();

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);
  await ctx.run('prod', ['browser', 'goto'], { path: '/' });

  const result = await ctx.run('prod', ['browser', 'click'], { role: 'button', name: 'Search' });

  expect({ exitCode: result.exitCode, posts: ctx.posts }).toStrictEqual({
    exitCode: 0,
    posts: ['/api/search'],
  });
});

test('it clicks by its snapshot ref the button a read-only target grants, inside an action', async () => {
  const ctx = await setupTest();

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);

  const result = await ctx.run('prod', ['action', 'click-by-ref'], { button: 'Search' });

  expect({ exitCode: result.exitCode, posts: ctx.posts }).toStrictEqual({
    exitCode: 0,
    posts: ['/api/search'],
  });
});

test('it refuses a click by snapshot ref on a button a read-only target does not grant, inside an action', async () => {
  const ctx = await setupTest();

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);

  const result = await ctx.run('prod', ['action', 'click-by-ref'], { button: 'Place order' });

  expect({
    exitCode: result.exitCode,
    error: result.envelope.error,
    posts: ctx.posts,
  }).toStrictEqual({
    exitCode: 3,
    error: {
      code: 'read-only',
      message: 'click on button "Place order" is a write, and the target is read-only.',
      hint: 'prod is read-only: place the order on local.',
    },
    posts: [],
  });
});

test('it refuses typing on a read-only target with exit code 3 and the target hint', async () => {
  const ctx = await setupTest();

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);
  await ctx.run('prod', ['browser', 'goto'], { path: '/' });

  const result = await ctx.run('prod', ['browser', 'type'], {
    role: 'textbox',
    name: 'Email',
    value: 'buyer@shop.example',
  });

  const after = await ctx.run('prod', ['browser', 'snapshot']);

  expect({
    exitCode: result.exitCode,
    error: result.envelope.error,
    after: after.envelope.data,
  }).toStrictEqual({
    exitCode: 3,
    error: {
      code: 'read-only',
      message: '`browser type` is a write, and target prod is read-only.',
      hint: 'prod is read-only: place the order on local.',
    },
    after: expect.objectContaining({
      snapshot: expect.stringMatching(/textbox "Email"[^\n]*\[ref=e\d+\]$/mu),
    }),
  });
});

test('it refuses typing inside an action that declared a read, at the client call', async () => {
  const ctx = await setupTest();

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);

  const result = await ctx.run('prod', ['action', 'sneak-email']);
  const after = await ctx.run('prod', ['browser', 'snapshot']);

  expect({
    exitCode: result.exitCode,
    error: result.envelope.error,
    after: after.envelope.data,
  }).toStrictEqual({
    exitCode: 3,
    error: {
      code: 'read-only',
      message: 'type on textbox "Email" is a write, and the target is read-only.',
      hint: 'prod is read-only: place the order on local.',
    },
    after: expect.objectContaining({
      snapshot: expect.stringMatching(/textbox "Email"[^\n]*\[ref=e\d+\]$/mu),
    }),
  });
});

test('it types into the field a read-only target grants', async () => {
  const ctx = await setupTest();

  await ctx.run('prod', ['attach']);
  await ctx.run('prod', ['doctor']);
  await ctx.run('prod', ['browser', 'goto'], { path: '/' });

  await ctx.run('prod', ['browser', 'type'], {
    role: 'textbox',
    name: 'Search terms',
    value: 'mugs',
  });

  const snapshot = await ctx.run('prod', ['browser', 'snapshot']);

  expect(snapshotSchema.parse(snapshot.envelope.data).snapshot).toMatch(
    /textbox "Search terms".*: mugs$/mu,
  );
});

test('it stops a browser action that ran past the command deadline before it lands', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['attach']);
  await ctx.run('local', ['doctor']);
  await ctx.run('local', ['browser', 'goto'], { path: '/' });

  const result = await ctx.runWithin(
    'local',
    ['browser', 'click'],
    { role: 'button', name: 'Restock' },
    500,
  );

  // The driver closes the page under the late click and loads the same URL in a new page.
  const reloaded = await waitFor(() => {
    invariant(ctx.pageLoads() === 2, 'The page has not reloaded yet.');

    return true;
  });

  ctx.revealRestock();

  await waitFor(async () => {
    const snapshot = await ctx.run('local', ['browser', 'snapshot']);

    const printed = snapshotSchema.parse(snapshot.envelope.data).snapshot;

    invariant(printed.includes('button "Restock"'), 'The page shows no Restock button yet.');
  });

  expect({ code: result.envelope.error?.code, reloaded, posts: ctx.posts }).toStrictEqual({
    code: 'timeout',
    reloaded: true,
    posts: [],
  });
});

test('it keeps a screenshot of the page as evidence', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['attach']);
  await ctx.run('local', ['doctor']);
  await ctx.run('local', ['browser', 'goto'], { path: '/' });

  const result = await ctx.run('local', ['browser', 'screenshot']);

  const evidencePath = result.envelope.evidence[0]?.path ?? '';

  const header = await Bun.file(join(ctx.root, evidencePath)).slice(0, 4).bytes();

  expect({ kind: result.envelope.evidence[0]?.kind, header: [...header] }).toStrictEqual({
    kind: 'screenshot',
    header: [0x89, 0x50, 0x4e, 0x47],
  });
});

test('it refuses a goto with a usage error when the endpoint is named after an inherited key', async () => {
  const ctx = await setupTest();

  await ctx.run('inherited', ['attach']);
  await ctx.run('inherited', ['doctor']);

  const result = await ctx.run('inherited', ['browser', 'goto'], { path: '/' });

  expect({ exitCode: result.exitCode, error: result.envelope.error }).toStrictEqual({
    exitCode: 2,
    error: {
      code: 'usage',
      message: 'Target inherited has no endpoint constructor.',
      hint: 'Set `baseURL` in the browser config of the target, or name an endpoint it has.',
    },
  });
});

test('it rejects a describe of a ref the last snapshot lacks', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['attach']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['browser', 'click'], { ref: 'e99' });

  expect({ exitCode: result.exitCode, error: result.envelope.error }).toStrictEqual({
    exitCode: 2,
    error: {
      code: 'usage',
      message: 'The last snapshot has no element e99.',
      hint: 'Run `browser snapshot`, then use a ref it printed.',
    },
  });
});
