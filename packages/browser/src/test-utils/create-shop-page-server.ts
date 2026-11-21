export interface ShopPageServer {
  readonly url: string;

  // A second app of the run on another origin, whose page has its own Search button.
  readonly adminURL: string;
  readonly adminPosts: readonly string[];
  readonly posts: readonly string[];
  readonly pageLoads: () => number;
  readonly revealRestock: () => void;
  readonly stop: () => Promise<void>;
}

const adminPage = `<!doctype html>
<title>Admin</title>
<h1>Admin</h1>
<button onclick="fetch('/api/search', { method: 'POST' })">Search</button>`;

// The admin app's page for a disabled Search button that is enabled a moment after it loads.
const adminEnablingPage = `<!doctype html>
<title>Admin enabling</title>
<button id="search" disabled onclick="fetch('/api/search', { method: 'POST' })">Search</button>
<script>setTimeout(() => { document.getElementById('search').disabled = false; }, 300);</script>`;

// A page that says Saving, and says Saved instead after a moment.
const changingPage = `<!doctype html>
<title>Changing</title>
<p id="state">Saving</p>
<script>setTimeout(() => { document.getElementById('state').textContent = 'Saved'; }, 600);</script>`;

const closingPage = `<!doctype html>
<title>Closing</title>
<button onclick="window.close()">Close this tab</button>`;

// A page of links to a file that the server sends as an attachment, one in a new tab and one in
// the same tab, and a link to an ordinary page in a new tab.
const downloadsPage = `<!doctype html>
<title>Downloads</title>
<a href="/files/report.csv" target="_blank" rel="opener">Download in a new tab</a>
<a href="/files/report.csv">Download in this tab</a>
<a href="/files/slow-report.csv" download>Download after a delay</a>
<a href="/orders" target="_blank" rel="opener">Open orders</a>`;

// A page whose elements record the one that was clicked in the title, to show how a text is found:
// by its whole text, through a line break, between blocks, past a hidden child, in a shadow root,
// and not through a label or a text-transform.
const textPage = `<!doctype html>
<title>Text</title>
<style>.upper { text-transform: uppercase; }</style>
<div onclick="pick('plain')">Add to basket</div>
<div onclick="pick('broken')">Gift<br>wrap now</div>
<div onclick="pick('blocks')"><div>Two</div><div>blocks</div></div>
<button onclick="pick('hidden-child')">Save<span hidden> draft</span></button>
<button class="upper" onclick="pick('transformed')">Pay now</button>
<button aria-label="Remove item" onclick="pick('labelled')">X</button>
<button onclick="pick('inline-flex')">Save<span style="display:inline-flex">draft</span></button>
<div onclick="pick('closed-details')">Keep<details><summary>Options</summary><span>secret</span></details></div>
<div onclick="pick('twin-one')">Twin</div>
<div onclick="pick('twin-two')">Twin</div>
<a role="menuitem" tabindex="0" onclick="pick('menu')">Billing and invoices</a>
<p>Billing and invoices overview</p>
<button onclick="pick('search')">Search</button>
<button onclick="pick('search-all')">Search all orders</button>
<div id="host"></div>
<script>
  function pick(name) { document.title = 'Picked ' + name; }
  const shadowButton = document.createElement('button');

  shadowButton.textContent = 'Inside the shadow';
  shadowButton.onclick = () => pick('shadow');
  document.querySelector('#host').attachShadow({ mode: 'open' }).append(shadowButton);
</script>`;

// A shop app for browser tests on a free port, with a second app on another origin: `/` holds
// fields, checkboxes, radios and links that open tabs, `/closing` closes its own tab, and `/text`
// has elements to find by their shown text. Each `/api` POST and each navigation to `/` is counted.
export function createShopPageServer(): ShopPageServer {
  const posts: string[] = [];
  const adminPosts: string[] = [];

  const adminServer = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    routes: {
      '/': { GET: () => new Response(adminPage, { headers: { 'content-type': 'text/html' } }) },
      '/enabling': {
        GET: () => new Response(adminEnablingPage, { headers: { 'content-type': 'text/html' } }),
      },
      '/api/search': {
        POST: () => {
          adminPosts.push('/api/search');

          return Response.json({ ok: true });
        },
      },
    },
  });

  const page = buildShopPage(adminServer.url.href);
  const leavingPage = buildLeavingPage(adminServer.url.href);
  const armingPage = buildArmingPage(adminServer.url.href);
  const slowArmingPage = buildSlowArmingPage(adminServer.url.href);
  const coveredPage = buildCoveredPage(adminServer.url.href);
  let restockReady = false;
  let pageLoads = 0;
  let basketFilled = false;

  const makePostRoute = (path: string) => ({
    POST: () => {
      posts.push(path);

      return Response.json({ ok: true });
    },
  });

  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    routes: {
      '/': {
        GET: (request) => {
          // The doctor's probe also asks for `/`, and only a browser navigation counts as a load.
          if (request.headers.get('sec-fetch-mode') === 'navigate') {
            pageLoads += 1;
          }

          return new Response(page, { headers: { 'content-type': 'text/html' } });
        },
      },
      '/orders': {
        GET: () =>
          new Response('<!doctype html><title>Orders</title><h1>Orders</h1>', {
            headers: { 'content-type': 'text/html' },
          }),
      },
      '/slow': {
        GET: () =>
          new Response(
            new ReadableStream({
              start: async (controller) => {
                controller.enqueue('<!doctype html><title>Slow</title>');

                await Bun.sleep(3000);

                controller.enqueue('<h1>Slow</h1>');
                controller.close();
              },
            }),
            { headers: { 'content-type': 'text/html' } },
          ),
      },
      '/arming': {
        GET: () => new Response(armingPage, { headers: { 'content-type': 'text/html' } }),
      },
      '/slow-arming': {
        GET: () => new Response(slowArmingPage, { headers: { 'content-type': 'text/html' } }),
      },
      '/covered': {
        GET: () => new Response(coveredPage, { headers: { 'content-type': 'text/html' } }),
      },
      '/leaving': {
        GET: () => new Response(leavingPage, { headers: { 'content-type': 'text/html' } }),
      },
      '/changing': {
        GET: () => new Response(changingPage, { headers: { 'content-type': 'text/html' } }),
      },
      '/downloads': {
        GET: () => new Response(downloadsPage, { headers: { 'content-type': 'text/html' } }),
      },
      '/text': {
        GET: () => new Response(textPage, { headers: { 'content-type': 'text/html' } }),
      },
      '/files/report.csv': {
        GET: () =>
          new Response('sku,count\nmug,2\n', {
            headers: {
              'content-type': 'text/csv',
              'content-disposition': 'attachment; filename="report.csv"',
            },
          }),
      },
      '/files/slow-report.csv': {
        GET: async () => {
          await Bun.sleep(600);

          return new Response('sku,count\nmug,2\n', {
            headers: {
              'content-type': 'text/csv',
              'content-disposition': 'attachment; filename="slow-report.csv"',
            },
          });
        },
      },
      '/closing': {
        GET: () => new Response(closingPage, { headers: { 'content-type': 'text/html' } }),
      },
      '/basket/fill': {
        GET: () => {
          const headers = new Headers({ 'content-type': 'text/html' });

          if (!basketFilled) {
            basketFilled = true;

            headers.set('set-cookie', 'basket=mugs; Path=/');
          }

          return new Response('<!doctype html><title>Basket filled</title>', { headers });
        },
      },
      '/basket': {
        GET: (request) => {
          const basket = request.cookies.get('basket') ?? 'empty';

          return new Response(`<!doctype html><title>Basket: ${basket}</title>`, {
            headers: { 'content-type': 'text/html' },
          });
        },
      },
      '/api/restock-ready': { GET: () => Response.json(restockReady) },
      '/api/orders': makePostRoute('/api/orders'),
      '/api/search': makePostRoute('/api/search'),
      '/api/restock': makePostRoute('/api/restock'),
    },
  });

  return {
    url: server.url.href,
    adminURL: adminServer.url.href,
    adminPosts,
    posts,
    pageLoads: () => pageLoads,
    revealRestock: () => {
      restockReady = true;
    },
    stop: async () => {
      await Promise.all([server.stop(true), adminServer.stop(true)]);
    },
  };
}

function buildShopPage(adminURL: string): string {
  return `<!doctype html>
<title>Shop</title>
<h1>Shop</h1>
<label>Email <input name="email"></label>
<label>Search terms <input name="terms"></label>
<button onclick="send('/api/orders', 'Ordered')">Place order</button>
<button onclick="send('/api/search', 'Searched')">Search</button>
<span class="wrap"><input type="checkbox" id="gift" name="gift"><span class="cover"></span></span><label for="gift">Gift wrap</label>
<label>Locked <input type="checkbox" name="locked" onclick="event.preventDefault()"></label>
<label>Archived <input type="checkbox" name="archived" disabled></label>
<label><input type="radio" name="shipping" value="post"> Post</label>
<label><input type="radio" name="shipping" value="courier"> Courier</label>
<label>Notes <input name="notes-one"></label>
<label>Notes <input name="notes-two"></label>
<a href="/orders" target="_blank" rel="opener">Open orders</a>
<a href="/closing" target="_blank" rel="opener">Open closing page</a>
<a href="${adminURL}" target="_blank" rel="opener">Open admin</a>
<a href="/slow" target="_blank" rel="opener">Open slow page</a>
<div id="menu-host" onmouseenter="document.querySelector('#menu').hidden = false">Account</div>
<div id="menu" hidden>Account menu</div>
<style>
  .wrap { position: relative; display: inline-block; width: 24px; height: 24px; }
  .wrap input { position: absolute; inset: 0; margin: 0; width: 20px; height: 20px; }
  .cover { position: absolute; inset: 0; border: 1px solid; background: white; }
</style>
<script>
  async function send(path, heading) {
    await fetch(path, { method: 'POST' });
    document.querySelector('h1').textContent = heading;
  }

  async function waitForRestock() {
    const answer = await fetch('/api/restock-ready');
    const ready = await answer.json();

    if (!ready) {
      setTimeout(waitForRestock, 50);
      return;
    }

    const button = document.createElement('button');

    button.textContent = 'Restock';
    button.onclick = () => send('/api/restock', 'Restocked');
    document.body.append(button);
  }

  waitForRestock();
</script>`;
}

// A page whose only Search button is hidden, and which moves to the admin app after a moment, so a
// click on the button waits and then finds the admin page's button.
function buildLeavingPage(adminURL: string): string {
  return `<!doctype html>
<title>Leaving</title>
<button hidden>Search</button>
<script>setTimeout(() => { location.href = '${adminURL}'; }, 600);</script>`;
}

// A page whose only Search button is shown but disabled, and which moves to the admin app after a
// moment, so a click on the button waits to be enabled and then finds the admin page's button.
function buildArmingPage(adminURL: string): string {
  return `<!doctype html>
<title>Arming</title>
<button disabled>Search</button>
<script>setTimeout(() => { location.href = '${adminURL}'; }, 600);</script>`;
}

// A page whose only Search button is shown but marked disabled, and which moves to a page of the admin app
// whose disabled Search button is enabled only after it loads, so the click waits across the move.
function buildSlowArmingPage(adminURL: string): string {
  return `<!doctype html>
<title>Slow arming</title>
<button aria-disabled="true">Search</button>
<script>setTimeout(() => { location.href = '${adminURL}enabling'; }, 600);</script>`;
}

// A page whose Search button is shown and enabled but covered by an overlay that nothing removes,
// and which moves to the admin app after a moment, so a click on the button waits for the overlay
// and then finds the admin page's uncovered button.
function buildCoveredPage(adminURL: string): string {
  return `<!doctype html>
<title>Covered</title>
<button>Search</button>
<div style="position: fixed; inset: 0; background: white;"></div>
<script>setTimeout(() => { location.href = '${adminURL}'; }, 600);</script>`;
}
