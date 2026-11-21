import { expect, onTestFinished, test } from 'bun:test';
import { join } from 'node:path';
import { readText } from '@wringer/core';
import { createTestSession } from '@wringer/core/test-utils/create-test-session.ts';
import { waitFor } from '@zgeoff/testing/helpers';
import invariant from 'tiny-invariant';
import { snapshotSchema } from './page-service-contract.ts';
import { createBrowserWringer } from './test-utils/create-browser-wringer.ts';
import { createShopPageServer } from './test-utils/create-shop-page-server.ts';

async function setupTest(shopURL?: string) {
  const server = createShopPageServer();

  onTestFinished(() => server.stop());

  const wringer = createBrowserWringer(shopURL ?? server.url, {
    adminURL: server.adminURL,
    actionTimeoutMs: 1500,
  });

  const shop = await createTestSession({
    parent: import.meta.dir,
    wringer,
    env: { SHOP_TOKEN: 'planted-shop-token' },
  });

  return {
    root: shop.repo.root,
    posts: server.posts,
    adminPosts: server.adminPosts,
    pageLoads: server.pageLoads,
    revealRestock: server.revealRestock,
    open: async (target: string) => {
      await shop.dispatch(wringer, ['attach'], {}, { ...shop.session, target });
      await shop.dispatch(wringer, ['doctor'], {}, { ...shop.session, target });
      await shop.dispatch(wringer, ['browser', 'goto'], { path: '/' }, { ...shop.session, target });
    },
    run: (target: string, path: readonly string[], args: unknown = {}) =>
      shop.dispatch(wringer, path, args, { ...shop.session, target }),
    runWithin: (target: string, path: readonly string[], args: unknown, timeoutMs: number) =>
      shop.dispatch(wringer, path, args, { ...shop.session, target, timeoutMs }),
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

  expect({
    error: result.envelope.error,
    data: result.envelope.data,
    kind: result.envelope.evidence[0]?.kind,
    header: [...header],
  }).toStrictEqual({
    error: null,
    data: {
      kind: 'screenshot',
      path: evidencePath,
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      scrub: 'opaque',
    },
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

test('it ticks a checkbox that a styled box covers, by its label', async () => {
  const ctx = await setupTest();

  await ctx.open('local');

  const result = await ctx.run('local', ['browser', 'check'], { label: 'Gift wrap' });

  expect({ error: result.envelope.error, data: result.envelope.data }).toStrictEqual({
    error: null,
    data: {
      url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/$/u),
      title: 'Shop',
      checked: true,
    },
  });
});

test('it unticks a checkbox it ticked', async () => {
  const ctx = await setupTest();

  await ctx.open('local');
  await ctx.run('local', ['browser', 'check'], { label: 'Gift wrap' });

  const result = await ctx.run('local', ['browser', 'uncheck'], { label: 'Gift wrap' });

  expect(result.envelope.data).toStrictEqual(expect.objectContaining({ checked: false }));
});

test('it ticks a radio button by its label', async () => {
  const ctx = await setupTest();

  await ctx.open('local');

  const result = await ctx.run('local', ['browser', 'check'], { label: 'Courier' });

  expect(result.envelope.data).toStrictEqual(expect.objectContaining({ checked: true }));
});

test.each([
  { case: 'unticking a radio button', command: 'uncheck', args: { label: 'Courier' } },
  { case: 'ticking a disabled checkbox', command: 'check', args: { label: 'Archived' } },
  { case: 'ticking a button', command: 'check', args: { role: 'button', name: 'Search' } },
])('it refuses $case with a usage error', async (row) => {
  const ctx = await setupTest();

  await ctx.open('local');

  const result = await ctx.run('local', ['browser', row.command], row.args);

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 2,
    code: 'usage',
  });
});

test('it fails a tick with check-failed when the checkbox keeps its state', async () => {
  const ctx = await setupTest();

  await ctx.open('local');

  const result = await ctx.run('local', ['browser', 'check'], { label: 'Locked' });

  expect(result.envelope.error?.code).toBe('check-failed');
});

test('it presses a key on the focused element when no locator is given', async () => {
  const ctx = await setupTest();

  await ctx.open('local');
  await ctx.run('local', ['browser', 'click'], { label: 'Email' });

  const pressed = await ctx.run('local', ['browser', 'press'], { key: 'x' });
  const snapshot = await ctx.run('local', ['browser', 'snapshot']);

  expect({
    error: pressed.envelope.error,
    snapshot: snapshotSchema.parse(snapshot.envelope.data).snapshot,
  }).toStrictEqual({
    error: null,
    snapshot: expect.stringMatching(/textbox "Email"[^\n]*: x$/mu),
  });
});

test('it presses a key on an element found by its label', async () => {
  const ctx = await setupTest();

  await ctx.open('local');
  await ctx.run('local', ['browser', 'press'], { key: 'y', label: 'Email' });

  const snapshot = await ctx.run('local', ['browser', 'snapshot']);

  expect(snapshotSchema.parse(snapshot.envelope.data).snapshot).toMatch(
    /textbox "Email"[^\n]*: "?y"?$/mu,
  );
});

test('it refuses a key the browser does not know with a usage error', async () => {
  const ctx = await setupTest();

  await ctx.open('local');

  const result = await ctx.run('local', ['browser', 'press'], { key: 'Enterr', label: 'Email' });

  expect(result.envelope.error?.code).toBe('usage');
});

test('it hovers over an element so the menu it opens shows', async () => {
  const ctx = await setupTest();

  await ctx.open('local');

  const before = await ctx.run('local', ['browser', 'snapshot']);

  const printed = snapshotSchema.parse(before.envelope.data).snapshot;
  const ref = /generic \[ref=(?<ref>e\d+)\]: Account/u.exec(printed)?.groups?.['ref'];

  const hovered = await ctx.run('local', ['browser', 'hover'], { ref });
  const after = await ctx.run('local', ['browser', 'snapshot']);

  expect({
    error: hovered.envelope.error,
    before: printed.includes('Account menu'),
    after: snapshotSchema.parse(after.envelope.data).snapshot.includes('Account menu'),
  }).toStrictEqual({ error: null, before: false, after: true });
});

test('it lists one active tab on a new page', async () => {
  const ctx = await setupTest();

  await ctx.open('local');

  const result = await ctx.run('local', ['browser', 'tabs']);

  expect(result.envelope.data).toStrictEqual({
    tabs: [{ index: 0, url: expect.stringMatching(/\/$/u), title: 'Shop', active: true }],
  });
});

test('it switches to the tab that a click opened, and says which tab opened', async () => {
  const ctx = await setupTest();

  await ctx.open('local');

  const result = await ctx.run('local', ['browser', 'click'], {
    role: 'link',
    name: 'Open orders',
  });

  const tabs = await ctx.run('local', ['browser', 'tabs']);

  expect({ data: result.envelope.data, tabs: tabs.envelope.data }).toStrictEqual({
    data: { url: expect.stringMatching(/\/orders$/u), title: 'Orders', openedTab: 1 },
    tabs: {
      tabs: [
        { index: 0, url: expect.stringMatching(/\/$/u), title: 'Shop', active: false },
        { index: 1, url: expect.stringMatching(/\/orders$/u), title: 'Orders', active: true },
      ],
    },
  });
});

test('it switches to a tab by its index', async () => {
  const ctx = await setupTest();

  await ctx.open('local');
  await ctx.run('local', ['browser', 'click'], { role: 'link', name: 'Open orders' });

  const result = await ctx.run('local', ['browser', 'tab'], { target: '0' });

  expect(result.envelope.data).toStrictEqual({
    url: expect.stringMatching(/\/$/u),
    title: 'Shop',
  });
});

test('it refuses a tab index that no tab has with a usage error', async () => {
  const ctx = await setupTest();

  await ctx.open('local');

  const result = await ctx.run('local', ['browser', 'tab'], { target: '4' });

  expect(result.envelope.error?.code).toBe('usage');
});

test('it fails a ref of an earlier snapshot after a switch of tabs as an unknown ref', async () => {
  const ctx = await setupTest();

  await ctx.open('local');

  const snapshot = await ctx.run('local', ['browser', 'snapshot']);

  const printed = snapshotSchema.parse(snapshot.envelope.data).snapshot;
  const ref = /button "Search" \[ref=(?<ref>e\d+)\]/u.exec(printed)?.groups?.['ref'];

  await ctx.run('local', ['browser', 'click'], { role: 'link', name: 'Open orders' });
  await ctx.run('local', ['browser', 'tab'], { target: '0' });

  const result = await ctx.run('local', ['browser', 'click'], { ref });

  expect({
    code: result.envelope.error?.code,
    message: result.envelope.error?.message,
  }).toStrictEqual({
    code: 'usage',
    message: `The last snapshot has no element ${ref}.`,
  });
});

test('it closes the active tab and returns to the tab that opened it', async () => {
  const ctx = await setupTest();

  await ctx.open('local');
  await ctx.run('local', ['browser', 'click'], { role: 'link', name: 'Open orders' });

  const result = await ctx.run('local', ['browser', 'tab'], { target: 'close' });

  expect(result.envelope.data).toStrictEqual({
    url: expect.stringMatching(/\/$/u),
    title: 'Shop',
    closedTab: 1,
  });
});

test('it refuses to close the last tab with a usage error', async () => {
  const ctx = await setupTest();

  await ctx.open('local');

  const result = await ctx.run('local', ['browser', 'tab'], { target: 'close' });

  expect(result.envelope.error?.code).toBe('usage');
});

test('it returns to the opener when the active tab closes itself, and says so', async () => {
  const ctx = await setupTest();

  await ctx.open('local');
  await ctx.run('local', ['browser', 'click'], { role: 'link', name: 'Open closing page' });

  const result = await ctx.run('local', ['browser', 'click'], {
    role: 'button',
    name: 'Close this tab',
  });

  expect({ error: result.envelope.error, data: result.envelope.data }).toStrictEqual({
    error: null,
    data: { url: expect.stringMatching(/\/$/u), title: 'Shop', closedTab: 1 },
  });
});

test('it clicks an element found by its label and role', async () => {
  const ctx = await setupTest();

  await ctx.open('local');

  const result = await ctx.run('local', ['browser', 'type'], {
    label: 'Email',
    role: 'textbox',
    value: 'buyer@shop.example',
  });

  expect(result.envelope.error).toBeNull();
});

test('it fails a label that no control has with check-failed once the action times out', async () => {
  const ctx = await setupTest();

  await ctx.open('local');

  const result = await ctx.run('local', ['browser', 'click'], { label: 'Nickname' });

  expect(result.envelope.error?.code).toBe('check-failed');
});

test('it fails a label that two controls have at once, with a hint to add a role or use a ref', async () => {
  const ctx = await setupTest();

  await ctx.open('local');

  const result = await ctx.run('local', ['browser', 'click'], { label: 'Notes' });

  expect(result.envelope.error).toStrictEqual({
    code: 'usage',
    message: 'More than one control has the label "Notes".',
    hint: 'Add --role to pick one, or use --ref from `browser snapshot`.',
  });
});

test('it refuses a label with a name as a usage error', async () => {
  const ctx = await setupTest();

  await ctx.open('local');

  const result = await ctx.run('local', ['browser', 'click'], { label: 'Email', name: 'Email' });

  expect(result.exitCode).toBe(2);
});

test('it maps a role and name that two elements match to a usage error that points at refs', async () => {
  const ctx = await setupTest();

  await ctx.open('local');

  const result = await ctx.run('local', ['browser', 'click'], { role: 'textbox', name: 'Notes' });

  expect({ code: result.envelope.error?.code, hint: result.envelope.error?.hint }).toStrictEqual({
    code: 'usage',
    hint: 'Run `browser snapshot` and pass one element by --ref.',
  });
});

test('it fails the doctor when the endpoint answers 500, naming the endpoint', async () => {
  const down = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    routes: { '/': () => new Response('down', { status: 500 }) },
  });

  onTestFinished(() => down.stop(true));

  const ctx = await setupTest(down.url.href);

  await ctx.run('local', ['attach']);

  const result = await ctx.run('local', ['doctor']);

  expect(result.envelope.data).toStrictEqual({
    passed: false,
    results: [
      expect.objectContaining({ name: 'browser.launched', status: 'passed' }),
      expect.objectContaining({
        name: 'browser.reachable',
        status: 'failed',
        code: 'check-failed',
        message: `Endpoint web at ${down.url.href} is not reachable. It answered 500.`,
      }),
    ],
  });
});

test('it passes the doctor when HEAD answers 405 and GET answers 200', async () => {
  const methods: string[] = [];

  const picky = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    routes: {
      '/': (request) => {
        methods.push(request.method);

        return request.method === 'HEAD'
          ? new Response(null, { status: 405 })
          : new Response('<title>Shop</title>');
      },
    },
  });

  onTestFinished(() => picky.stop(true));

  const ctx = await setupTest(picky.url.href);

  await ctx.run('local', ['attach']);

  const result = await ctx.run('local', ['doctor']);

  expect({ passed: result.envelope.data, methods }).toStrictEqual({
    passed: expect.objectContaining({ passed: true }),
    methods: ['HEAD', 'GET'],
  });
});

test('it fails the doctor when the endpoint refuses the connection', async () => {
  const gone = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    routes: { '/': () => new Response('ok') },
  });

  const goneURL = gone.url.href;

  await gone.stop(true);

  const ctx = await setupTest(goneURL);

  await ctx.run('local', ['attach']);

  const result = await ctx.run('local', ['doctor']);

  expect(result.envelope.data).toStrictEqual({
    passed: false,
    results: [
      expect.objectContaining({ name: 'browser.launched', status: 'passed' }),
      expect.objectContaining({
        name: 'browser.reachable',
        status: 'failed',
        code: 'check-failed',
        message: expect.stringContaining(
          `Endpoint web at ${goneURL} is not reachable. It did not answer`,
        ),
      }),
    ],
  });
});

test('it passes the doctor when the endpoint redirects', async () => {
  const redirecting = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    routes: {
      '/': () => new Response(null, { status: 302, headers: { location: '/login' } }),
    },
  });

  onTestFinished(() => redirecting.stop(true));

  const ctx = await setupTest(redirecting.url.href);

  await ctx.run('local', ['attach']);

  const result = await ctx.run('local', ['doctor']);

  expect(result.envelope.data).toStrictEqual(expect.objectContaining({ passed: true }));
});

test('it opens a page of a listed endpoint', async () => {
  const ctx = await setupTest();

  await ctx.open('local');

  const result = await ctx.run('local', ['browser', 'goto'], { path: '/', endpoint: 'admin' });

  expect(result.envelope.data).toStrictEqual({
    url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/$/u),
    title: 'Admin',
  });
});

test('it refuses an endpoint the config does not list, with the allowed names in the hint', async () => {
  const ctx = await setupTest();

  await ctx.open('prod');

  const result = await ctx.run('prod', ['browser', 'goto'], { path: '/', endpoint: 'admin' });

  expect(result.envelope.error).toStrictEqual({
    code: 'usage',
    message: 'The browser config of target prod does not list the endpoint admin.',
    hint: 'Name one of web, or list the endpoint in the `endpoints` of the browser config.',
  });
});

test.each([{ command: 'snapshot' }, { command: 'screenshot' }])(
  'it refuses $command before any goto with a usage error and keeps no evidence',
  async (row) => {
    const ctx = await setupTest();

    await ctx.run('local', ['attach']);
    await ctx.run('local', ['doctor']);

    const result = await ctx.run('local', ['browser', row.command]);

    expect({ code: result.envelope.error?.code, evidence: result.envelope.evidence }).toStrictEqual(
      {
        code: 'usage',
        evidence: [],
      },
    );
  },
);

test('it reports an environment error that points at the tabs when a cancel arrives after a click landed', async () => {
  const ctx = await setupTest();

  await ctx.open('local');

  const result = await ctx.runWithin(
    'local',
    ['browser', 'click'],
    { role: 'link', name: 'Open slow page' },
    2000,
  );

  expect({ code: result.envelope.error?.code, hint: result.envelope.error?.hint }).toStrictEqual({
    code: 'environment',
    hint: 'Run `browser tabs` to see what the action changed.',
  });
});

test('it refuses a key press with no locator on a read-only target', async () => {
  const ctx = await setupTest();

  await ctx.open('prod');

  const result = await ctx.run('prod', ['browser', 'press'], { key: 'Enter' });

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 3,
    code: 'read-only',
  });
});

test('it refuses a label with no granted role on a read-only target', async () => {
  const ctx = await setupTest();

  await ctx.open('prod');

  const result = await ctx.run('prod', ['browser', 'type'], {
    label: 'Search terms',
    value: 'mugs',
  });

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 3,
    code: 'read-only',
  });
});

test('it types into the label that a read-only target grants with its role', async () => {
  const ctx = await setupTest();

  await ctx.open('prod');

  const result = await ctx.run('prod', ['browser', 'type'], {
    label: 'Search terms',
    role: 'textbox',
    value: 'mugs',
  });

  expect({ exitCode: result.exitCode, error: result.envelope.error }).toStrictEqual({
    exitCode: 0,
    error: null,
  });
});

test('it refuses a tick of an ungranted checkbox on a read-only target', async () => {
  const ctx = await setupTest();

  await ctx.open('prod');

  const result = await ctx.run('prod', ['browser', 'check'], { label: 'Gift wrap' });

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 3,
    code: 'read-only',
  });
});

test('it hovers, lists tabs and switches tabs on a read-only target', async () => {
  const ctx = await setupTest();

  await ctx.open('prod');

  const hover = await ctx.run('prod', ['browser', 'hover'], { label: 'Email' });
  const tabs = await ctx.run('prod', ['browser', 'tabs']);
  const tab = await ctx.run('prod', ['browser', 'tab'], { target: '0' });

  expect([hover.exitCode, tabs.exitCode, tab.exitCode]).toStrictEqual([0, 0, 0]);
});

test('it refuses a granted click once the active tab is on an origin the config does not list', async () => {
  const ctx = await setupTest();

  await ctx.open('tour');
  await ctx.run('tour', ['browser', 'click'], { role: 'link', name: 'Open admin' });

  const result = await ctx.run('tour', ['browser', 'click'], { role: 'button', name: 'Search' });

  expect({
    exitCode: result.exitCode,
    code: result.envelope.error?.code,
    adminPosts: ctx.adminPosts,
  }).toStrictEqual({ exitCode: 3, code: 'read-only', adminPosts: [] });
});

test('it allows a granted click on the origin of a listed endpoint', async () => {
  const ctx = await setupTest();

  await ctx.open('wide');
  await ctx.run('wide', ['browser', 'click'], { role: 'link', name: 'Open admin' });

  const result = await ctx.run('wide', ['browser', 'click'], { role: 'button', name: 'Search' });

  expect({ exitCode: result.exitCode, adminPosts: ctx.adminPosts }).toStrictEqual({
    exitCode: 0,
    adminPosts: ['/api/search'],
  });
});

test('it refuses a granted click that waits for a control while the tab leaves the listed origins', async () => {
  const ctx = await setupTest();

  await ctx.open('tour');
  await ctx.run('tour', ['browser', 'goto'], { path: '/leaving' });

  const result = await ctx.run('tour', ['browser', 'click'], { role: 'button', name: 'Search' });

  expect({
    exitCode: result.exitCode,
    code: result.envelope.error?.code,
    adminPosts: ctx.adminPosts,
  }).toStrictEqual({ exitCode: 3, code: 'read-only', adminPosts: [] });
});

test('it refuses a granted click that waits for a disabled control while the tab leaves the listed origins', async () => {
  const ctx = await setupTest();

  await ctx.open('tour');
  await ctx.run('tour', ['browser', 'goto'], { path: '/arming' });

  const result = await ctx.run('tour', ['browser', 'click'], { role: 'button', name: 'Search' });

  expect({
    exitCode: result.exitCode,
    code: result.envelope.error?.code,
    adminPosts: ctx.adminPosts,
  }).toStrictEqual({ exitCode: 3, code: 'read-only', adminPosts: [] });
});

test('it refuses a granted click on a disabled control that is enabled only after the tab leaves the listed origins', async () => {
  const ctx = await setupTest();

  await ctx.open('tour');
  await ctx.run('tour', ['browser', 'goto'], { path: '/slow-arming' });

  const result = await ctx.run('tour', ['browser', 'click'], { role: 'button', name: 'Search' });

  expect({
    exitCode: result.exitCode,
    code: result.envelope.error?.code,
    adminPosts: ctx.adminPosts,
  }).toStrictEqual({ exitCode: 3, code: 'read-only', adminPosts: [] });
});

test('it refuses a granted click that waits for a covering overlay while the tab leaves the listed origins', async () => {
  const ctx = await setupTest();

  await ctx.open('tour');
  await ctx.run('tour', ['browser', 'goto'], { path: '/covered' });

  const result = await ctx.run('tour', ['browser', 'click'], { role: 'button', name: 'Search' });

  expect({
    exitCode: result.exitCode,
    code: result.envelope.error?.code,
    adminPosts: ctx.adminPosts,
  }).toStrictEqual({ exitCode: 3, code: 'read-only', adminPosts: [] });
});

test('it fails a ref from before a tab switch as unknown when hovering', async () => {
  const ctx = await setupTest();

  await ctx.open('local');

  const snapshot = await ctx.run('local', ['browser', 'snapshot']);

  const printed = snapshotSchema.parse(snapshot.envelope.data).snapshot;
  const ref = /textbox "Email" \[ref=(?<ref>e\d+)\]/u.exec(printed)?.groups?.['ref'];

  await ctx.run('local', ['browser', 'click'], { role: 'link', name: 'Open orders' });
  await ctx.run('local', ['browser', 'tab'], { target: '0' });

  const result = await ctx.run('local', ['browser', 'hover'], { ref });

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 2,
    code: 'usage',
  });
});

test('it ticks and unticks a checkbox that a box lies over, by its label', async () => {
  const ctx = await setupTest();

  await ctx.open('local');

  const ticked = await ctx.run('local', ['browser', 'check'], { label: 'Gift wrap' });
  const unticked = await ctx.run('local', ['browser', 'uncheck'], { label: 'Gift wrap' });

  expect([ticked.envelope.data, unticked.envelope.data]).toStrictEqual([
    expect.objectContaining({ checked: true }),
    expect.objectContaining({ checked: false }),
  ]);
});

test.each([
  { flag: 'until-text', args: { untilText: 'Saved' } },
  { flag: 'until-no-text', args: { untilNoText: 'Saving' } },
  { flag: 'both flags', args: { untilText: 'Saved', untilNoText: 'Saving' } },
])('it waits with $flag for a page that changes after a moment', async (row) => {
  const ctx = await setupTest();

  await ctx.run('local', ['attach']);
  await ctx.run('local', ['doctor']);
  await ctx.run('local', ['browser', 'goto'], { path: '/changing' });

  const result = await ctx.run('local', ['browser', 'snapshot'], row.args);

  const evidencePath = result.envelope.evidence[0]?.path ?? '';

  expect({
    error: result.envelope.error,
    snapshot: snapshotSchema.parse(result.envelope.data).snapshot,
    evidence: await readText(join(ctx.root, evidencePath)),
  }).toStrictEqual({
    error: null,
    snapshot: expect.stringContaining('Saved'),
    evidence: expect.stringContaining('Saved'),
  });
});

test('it keeps the last snapshot as evidence when the text never shows', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['attach']);
  await ctx.run('local', ['doctor']);
  await ctx.run('local', ['browser', 'goto'], { path: '/changing' });

  const result = await ctx.run('local', ['browser', 'snapshot'], { untilText: 'Shipped' });

  const evidencePath = result.envelope.evidence[0]?.path ?? '';

  expect({
    error: result.envelope.error,
    evidence: await readText(join(ctx.root, evidencePath)),
  }).toStrictEqual({
    error: {
      code: 'check-failed',
      message: expect.stringMatching(/^The page never showed the text "Shipped" after 1\.\d s\.$/u),
      hint: 'Read the last snapshot in the evidence, `snapshot.yaml`, to see what the page showed.',
    },
    evidence: expect.stringContaining('Saved'),
  });
});

test('it names the text that still shows when it never goes', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['attach']);
  await ctx.run('local', ['doctor']);
  await ctx.run('local', ['browser', 'goto'], { path: '/' });

  const result = await ctx.run('local', ['browser', 'snapshot'], { untilNoText: 'Place order' });

  expect(result.envelope.error?.message).toMatch(
    /^The page still shows the text "Place order" after /u,
  );
});

test('it keeps a declared secret in the waited text redacted in the error', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['attach']);
  await ctx.run('local', ['doctor']);
  await ctx.run('local', ['browser', 'goto'], { path: '/changing' });

  const result = await ctx.run('local', ['browser', 'snapshot'], {
    untilText: 'planted-shop-token',
  });

  expect(result.envelope.error?.message).toMatch(
    /^The page never showed the text "\[redacted:SHOP_TOKEN\]" after /u,
  );
});

test('it rejects an empty text to wait for', async () => {
  const ctx = await setupTest();

  await ctx.run('local', ['attach']);
  await ctx.run('local', ['doctor']);

  const result = await ctx.run('local', ['browser', 'snapshot'], { untilText: '' });

  expect(result.envelope.error?.code).toBe('usage');
});

test.each([
  {
    case: 'a click in a new tab',
    command: 'click',
    args: { role: 'link', name: 'Download in a new tab' },
  },
  {
    case: 'a click in the same tab',
    command: 'click',
    args: { role: 'link', name: 'Download in this tab' },
  },
  {
    case: 'a key press in the same tab',
    command: 'press',
    args: { key: 'Enter', role: 'link', name: 'Download in this tab' },
  },
  {
    case: 'a click on a download-attribute link whose response is delayed',
    command: 'click',
    args: { role: 'link', name: 'Download after a delay' },
    fileName: 'slow-report.csv',
  },
])('it reports the download of $case and stays on the page with one tab', async (row) => {
  const ctx = await setupTest();

  await ctx.open('local');
  await ctx.run('local', ['browser', 'goto'], { path: '/downloads' });

  const result = await ctx.run('local', ['browser', row.command], row.args);
  const tabs = await ctx.run('local', ['browser', 'tabs']);

  expect({
    error: result.envelope.error,
    data: result.envelope.data,
    tabs: tabs.envelope.data,
  }).toStrictEqual({
    error: null,
    data: {
      url: expect.stringMatching(/\/downloads$/u),
      title: 'Downloads',
      download: {
        url: expect.stringMatching(/\/files\/(?:slow-)?report\.csv$/u),
        fileName: row.fileName ?? 'report.csv',
      },
    },
    tabs: {
      tabs: [
        { index: 0, url: expect.stringMatching(/\/downloads$/u), title: 'Downloads', active: true },
      ],
    },
  });
});

test('it keeps no file of a download as evidence', async () => {
  const ctx = await setupTest();

  await ctx.open('local');
  await ctx.run('local', ['browser', 'goto'], { path: '/downloads' });

  const result = await ctx.run('local', ['browser', 'click'], {
    role: 'link',
    name: 'Download in a new tab',
  });

  expect(result.envelope.evidence).toStrictEqual([]);
});

test('it still switches to a normal new tab on a page that links to downloads', async () => {
  const ctx = await setupTest();

  await ctx.open('local');
  await ctx.run('local', ['browser', 'goto'], { path: '/downloads' });

  const result = await ctx.run('local', ['browser', 'click'], {
    role: 'link',
    name: 'Open orders',
  });

  expect(result.envelope.data).toStrictEqual({
    url: expect.stringMatching(/\/orders$/u),
    title: 'Orders',
    openedTab: 1,
  });
});

test.each([
  { case: 'a whole text', args: { text: 'Add to basket' }, picked: 'plain' },
  { case: 'a text across a line break', args: { text: 'Gift wrap now' }, picked: 'broken' },
  { case: 'a text across two blocks', args: { text: 'Two blocks' }, picked: 'blocks' },
  { case: 'a text with a hidden child', args: { text: 'Save' }, picked: 'hidden-child' },
  {
    case: 'a text joined to an inline-flex child',
    args: { text: 'Savedraft' },
    picked: 'inline-flex',
  },
  {
    case: 'a text beside a closed details element',
    args: { text: 'Keep Options' },
    picked: 'closed-details',
  },
  { case: 'a text in an open shadow root', args: { text: 'Inside the shadow' }, picked: 'shadow' },
  { case: 'a text before its text-transform', args: { text: 'Pay now' }, picked: 'transformed' },
  {
    case: 'a part of a text with a role',
    args: { text: 'invoices', role: 'menuitem' },
    picked: 'menu',
  },
])('it clicks the element found by $case', async (row) => {
  const ctx = await setupTest();

  await ctx.open('local');
  await ctx.run('local', ['browser', 'goto'], { path: '/text' });

  const result = await ctx.run('local', ['browser', 'click'], row.args);

  expect({ error: result.envelope.error, data: result.envelope.data }).toStrictEqual({
    error: null,
    data: { url: expect.stringMatching(/\/text$/u), title: `Picked ${row.picked}` },
  });
});

test.each([
  { case: 'an aria-label', text: 'Remove item' },
  { case: 'a text in the case of its text-transform', text: 'PAY NOW' },
  { case: 'a text that a hidden child completes', text: 'Save draft' },
  { case: 'a part of a text without a role', text: 'invoices' },
  {
    case: 'a text that the content of a closed details element completes',
    text: 'Keep Options secret',
  },
])('it fails $case with check-failed once the action times out', async (row) => {
  const ctx = await setupTest();

  await ctx.open('local');
  await ctx.run('local', ['browser', 'goto'], { path: '/text' });

  const result = await ctx.run('local', ['browser', 'click'], { text: row.text });

  expect(result.envelope.error?.code).toBe('check-failed');
});

test.each([
  { case: 'two elements with the same text', args: { text: 'Twin' }, count: 2, role: '' },
  {
    case: 'two buttons that hold the text',
    args: { text: 'Search', role: 'button' },
    count: 2,
    role: ' with the role button',
  },
])('it fails $case at once with check-failed and the count', async (row) => {
  const ctx = await setupTest();

  await ctx.open('local');
  await ctx.run('local', ['browser', 'goto'], { path: '/text' });

  const result = await ctx.run('local', ['browser', 'click'], row.args);

  expect(result.envelope.error).toStrictEqual({
    code: 'check-failed',
    message: `${row.count} elements show the text "${row.args.text}"${row.role}.`,
    hint: 'Add --role to narrow the match, or use --ref from `browser snapshot`.',
  });
});

test('it hovers over the element that shows a text', async () => {
  const ctx = await setupTest();

  await ctx.open('local');
  await ctx.run('local', ['browser', 'goto'], { path: '/text' });

  const result = await ctx.run('local', ['browser', 'hover'], { text: 'Add to basket' });

  expect({ error: result.envelope.error, data: result.envelope.data }).toStrictEqual({
    error: null,
    data: { url: expect.stringMatching(/\/text$/u), title: 'Text' },
  });
});

test.each([
  { case: 'a text with a name', args: { text: 'Search', name: 'Search' } },
  { case: 'a text with a label', args: { text: 'Search', label: 'Search' } },
  { case: 'a role alone', args: { role: 'button' } },
])('it refuses $case as a usage error', async (row) => {
  const ctx = await setupTest();

  await ctx.open('local');

  const result = await ctx.run('local', ['browser', 'click'], row.args);

  expect(result.exitCode).toBe(2);
});

test('it refuses a click on a text on a read-only target with exit code 3', async () => {
  const ctx = await setupTest();

  await ctx.open('prod');
  await ctx.run('prod', ['browser', 'goto'], { path: '/text' });

  const result = await ctx.run('prod', ['browser', 'click'], { text: 'Search all orders' });

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 3,
    code: 'read-only',
  });
});

test('it clicks only the element that a read-only target grants by role and name for a text', async () => {
  const ctx = await setupTest();

  await ctx.open('prod');
  await ctx.run('prod', ['browser', 'goto'], { path: '/text' });

  const result = await ctx.run('prod', ['browser', 'click'], { text: 'Search', role: 'button' });

  expect({ error: result.envelope.error, data: result.envelope.data }).toStrictEqual({
    error: null,
    data: { url: expect.stringMatching(/\/text$/u), title: 'Picked search' },
  });
});
