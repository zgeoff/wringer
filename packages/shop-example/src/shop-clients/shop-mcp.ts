import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { ordersSchema, placedOrderSchema } from '../shop-contract.ts';

// The example shop's MCP server over stdio: a read tool that lists the orders and a write tool that
// places one, both through the shop's API. SHOP_URL holds the shop's address.
const shopURL = process.env['SHOP_URL'] ?? '';

serveStdio(() => {
  const server = new McpServer({ name: 'shop', version: '1.0.0' });

  server.registerTool(
    'list_orders',
    {
      description: 'List the orders placed in the shop',
      outputSchema: z.object({ orders: ordersSchema }),
    },
    async () => {
      const response = await fetch(new URL('/api/orders', shopURL));
      const body: unknown = await response.json();

      const orders = ordersSchema.parse(body);

      return {
        content: [{ type: 'text', text: `${String(orders.length)} orders` }],
        structuredContent: { orders },
      };
    },
  );

  server.registerTool(
    'place_order',
    {
      description: 'Place one order in the shop',
      outputSchema: placedOrderSchema,
    },
    async () => {
      const response = await fetch(new URL('/api/orders', shopURL), { method: 'POST' });
      const body: unknown = await response.json();

      const order = placedOrderSchema.parse(body);

      return {
        content: [{ type: 'text', text: `placed order ${String(order.id)}` }],
        structuredContent: order,
      };
    },
  );

  return server;
});
