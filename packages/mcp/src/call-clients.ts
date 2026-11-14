import type { ServiceCaller } from '@wringer/core';
import type { z } from 'zod';
import { clientsServiceContract } from './mcp-service-contract.ts';
import type { ClientsArgs, ClientsMethod, ClientsResult } from './mcp-service-contract.ts';

// Indexing this mapped type by a method keeps that method's result type, which indexing the
// contract's own type loses to a union of every result.
type ClientsResultSchemas = {
  readonly [Method in ClientsMethod]: { readonly result: z.ZodType<ClientsResult<Method>> };
};

const resultSchemas: ClientsResultSchemas = clientsServiceContract;

export async function callClients<Method extends ClientsMethod>(
  clients: ServiceCaller,
  method: Method,
  args: ClientsArgs<Method>,
): Promise<ClientsResult<Method>> {
  const answer = await clients.call(method, args);

  return resultSchemas[method].result.parse(answer);
}
