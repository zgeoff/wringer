export interface ShopPageServer {
  readonly url: string;
  readonly posts: readonly string[];
  readonly stop: () => Promise<void>;
}

const page = `<!doctype html>
<title>Shop</title>
<h1>Shop</h1>
<label>Email <input name="email"></label>
<button onclick="send('/api/orders', 'Ordered')">Place order</button>
<button onclick="send('/api/search', 'Searched')">Search</button>
<script>
  async function send(path, heading) {
    await fetch(path, { method: 'POST' });
    document.querySelector('h1').textContent = heading;
  }
</script>`;

// A shop app for browser tests on a free port: `/` serves a page with an email field, a button
// that posts an order and a button that posts a search, and the server records each POST path.
export function createShopPageServer(): ShopPageServer {
  const posts: string[] = [];

  const answerRequest = (request: Request): Response => {
    const path = new URL(request.url).pathname;

    if (request.method === 'POST') {
      posts.push(path);

      return Response.json({ ok: true });
    }

    return new Response(page, { headers: { 'content-type': 'text/html' } });
  };

  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: answerRequest });

  return { url: server.url.href, posts, stop: () => server.stop(true) };
}
