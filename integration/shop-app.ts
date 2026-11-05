import { Database } from 'bun:sqlite';
import { OpenAPIHandler } from '@orpc/openapi/fetch';
import { implement } from '@orpc/server';
import { ordersSchema, placedOrderSchema, shopContract } from './shop-contract.ts';
import type { Order, PlacedOrder } from './shop-contract.ts';

// The example shop app that the journey test launches: a page with a Place order button, the orders
// API of the shop contract over a SQLite file at SHOP_DB, and one log line per order. It prints its ready line once it
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

function readOrders(): Order[] {
  return ordersSchema.parse(database.query('select id, item from orders order by id').all());
}

function writeOrder(): PlacedOrder {
  const placed = database.run('insert into orders (item) values (?)', ['mug']);
  const order = placedOrderSchema.parse({ id: Number(placed.lastInsertRowid) });

  console.log(`order ${order.id} placed`);

  return order;
}

const shop = implement(shopContract);

const ordersAPI = new OpenAPIHandler(
  shop.router({
    orders: {
      list: shop.orders.list.handler(() => readOrders()),
      place: shop.orders.place.handler(() => writeOrder()),
    },
  }),
);

const server = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  routes: {
    '/api/*': async (request) => {
      const answered = await ordersAPI.handle(request);

      return answered.matched ? answered.response : new Response('Not found', { status: 404 });
    },
    '/': new Response(page, { headers: { 'content-type': 'text/html' } }),
  },
});

console.log(JSON.stringify({ event: 'listening', port: server.port }));
