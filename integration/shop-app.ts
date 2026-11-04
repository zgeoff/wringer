import { Database } from 'bun:sqlite';

// The example shop app that the journey test launches: a page with a Place order button, an orders
// API over a SQLite file at SHOP_DB, and one log line per order. It prints its ready line once it
// listens, as a launch target expects.
const database = new Database(process.env['SHOP_DB'] ?? ':memory:', { create: true });

database.run('create table if not exists orders (id integer primary key, item text not null)');

const page = `<!doctype html>
<title>Shop</title>
<h1>Shop</h1>
<button onclick="placeOrder()">Place order</button>
<script>
  async function placeOrder() {
    const response = await fetch('/api/orders', { method: 'POST' });
    const order = await response.json();
    document.querySelector('h1').textContent = 'Order ' + order.id + ' placed';
  }
</script>`;

function answerRequest(request: Request): Response {
  const path = new URL(request.url).pathname;

  if (path === '/api/orders' && request.method === 'POST') {
    const placed = database.run('insert into orders (item) values (?)', ['mug']);
    const id = Number(placed.lastInsertRowid);

    console.log(`order ${id} placed`);

    return Response.json({ id });
  }

  if (path === '/api/orders') {
    return Response.json(database.query('select id, item from orders order by id').all());
  }

  return new Response(page, { headers: { 'content-type': 'text/html' } });
}

const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: answerRequest });

console.log(JSON.stringify({ event: 'listening', port: server.port }));
