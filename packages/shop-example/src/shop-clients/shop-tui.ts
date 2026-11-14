import { ordersSchema } from '../shop-contract.ts';

// The example shop's terminal screen: it lists the orders from the shop's API, redraws them when
// `r` is pressed, and exits on `q`. SHOP_URL holds the shop's address.
const shopURL = process.env['SHOP_URL'] ?? '';
let refreshes = 0;

async function readOrders(): Promise<string> {
  const response = await fetch(new URL('/api/orders', shopURL));
  const body: unknown = await response.json();

  const orders = ordersSchema.parse(body);

  return orders.map((order) => ` ${String(order.id)}  ${order.item}`).join('\r\n');
}

async function draw(): Promise<void> {
  const orders = await readOrders();

  process.stdout.write(
    `\u001B[2J\u001B[H\u001B[1mShop orders\u001B[0m\r\n${orders}\r\n\r\nRefreshes: ${String(refreshes)}\r\n[r] refresh  [q] quit`,
  );
}

process.stdin.setRawMode(true);

process.stdin.on('data', (chunk: Buffer) => {
  const key = chunk.toString('utf8');

  if (key === 'q') {
    process.exit(0);
  }

  if (key === 'r') {
    refreshes += 1;
    void draw();
  }
});

await draw();

process.stdin.resume();
