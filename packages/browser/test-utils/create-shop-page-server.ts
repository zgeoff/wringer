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
// records each POST path and counts the page loads.
export function createShopPageServer(): ShopPageServer {
  const posts: string[] = [];
  let restockReady = false;
  let pageLoads = 0;

  const answerRequest = (request: Request): Response => {
    const path = new URL(request.url).pathname;

    if (request.method === 'POST') {
      posts.push(path);

      return Response.json({ ok: true });
    }

    if (path === '/api/restock-ready') {
      return Response.json(restockReady);
    }

    pageLoads += 1;

    return new Response(page, { headers: { 'content-type': 'text/html' } });
  };

  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: answerRequest });

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
