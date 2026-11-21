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

const closingPage = `<!doctype html>
<title>Closing</title>
<button onclick="window.close()">Close this tab</button>`;

// A shop app for browser tests on a free port, with a second app on another origin: `/` holds
// fields, checkboxes, radios and links that open tabs, and `/closing` closes its own tab. Each
// `/api` POST and each browser navigation to `/` is counted.
export function createShopPageServer(): ShopPageServer {
  const posts: string[] = [];
  const adminPosts: string[] = [];

  const adminServer = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    routes: {
      '/': { GET: () => new Response(adminPage, { headers: { 'content-type': 'text/html' } }) },
      '/api/search': {
        POST: () => {
          adminPosts.push('/api/search');

          return Response.json({ ok: true });
        },
      },
    },
  });

  const page = buildShopPage(adminServer.url.href);
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
<label>Gift wrap <span class="box"></span><input type="checkbox" name="gift" class="covered"></label>
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
  .box { display: inline-block; width: 24px; height: 24px; border: 1px solid; }
  .covered { position: absolute; opacity: 0; width: 20px; height: 20px; }
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
