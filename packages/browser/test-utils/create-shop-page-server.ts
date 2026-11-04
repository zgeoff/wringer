export interface ShopPageServer {
  readonly url: string;
  readonly posts: readonly string[];
  readonly pageLoads: () => number;
  readonly revealRestock: () => void;
  readonly stop: () => Promise<void>;
}

const page = `<!doctype html>
<title>Shop</title>
<h1>Shop</h1>
<label>Email <input name="email"></label>
<label>Search terms <input name="terms"></label>
<button onclick="send('/api/orders', 'Ordered')">Place order</button>
<button onclick="send('/api/search', 'Searched')">Search</button>
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

// A shop app for browser tests on a free port: `/` serves a page with two fields, order and search
// buttons, and a Restock button that appears once the test calls `revealRestock`. The server
// records the path of each POST to an `/api` route and counts the page loads.
export function createShopPageServer(): ShopPageServer {
  const posts: string[] = [];
  let restockReady = false;
  let pageLoads = 0;

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
        GET: () => {
          pageLoads += 1;

          return new Response(page, { headers: { 'content-type': 'text/html' } });
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
    posts,
    pageLoads: () => pageLoads,
    revealRestock: () => {
      restockReady = true;
    },
    stop: () => server.stop(true),
  };
}
