/// <reference lib="dom" />
import { createORPCClient } from '@orpc/client';
import type { ContractRouterClient } from '@orpc/contract';
import { OpenAPILink } from '@orpc/openapi-client/fetch';
import { shopContract } from './shop-contract.ts';

// The page's script: it places an order through a client built from the contract the app serves,
// so a change to the orders route or its output fails the type check here as well.
const shop: ContractRouterClient<typeof shopContract> = createORPCClient(
  new OpenAPILink(shopContract, { url: globalThis.location.origin }),
);

const heading = document.querySelector('h1');

async function placeOrder(): Promise<void> {
  const text = await shop.orders.place().then(
    (order) => `Order ${order.id} placed`,
    (error: unknown) =>
      `The order failed: ${error instanceof Error ? error.message : String(error)}`,
  );

  if (heading !== null) {
    heading.textContent = text;
  }
}

document.querySelector('button')?.addEventListener('click', () => {
  void placeOrder();
});
