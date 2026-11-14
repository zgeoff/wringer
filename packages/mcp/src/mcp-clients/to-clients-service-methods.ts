import type { ServiceMethod } from '@wringer/core';
import type { z } from 'zod';
import { clientsServiceContract } from '../clients-service-contract.ts';
import type { ClientsArgs, ClientsMethod, ClientsResult } from '../clients-service-contract.ts';

export type ClientsHandlers = {
  readonly [Method in ClientsMethod]: (
    args: ClientsArgs<Method>,
    signal: AbortSignal,
  ) => Promise<ClientsResult<Method>>;
};

// Each method parses its request against the contract, so a handler only sees the args the client
// was typed to send.
export function toClientsServiceMethods(
  handlers: ClientsHandlers,
): Readonly<Record<ClientsMethod, ServiceMethod>> {
  return {
    tools: bindMethod(clientsServiceContract.tools.args, handlers.tools),
    call: bindMethod(clientsServiceContract.call.args, handlers.call),
  };
}

function bindMethod<Schema extends z.ZodType>(
  schema: Schema,
  handler: (args: z.output<Schema>, signal: AbortSignal) => Promise<unknown>,
): ServiceMethod {
  return (args, signal) => Promise.try(() => handler(schema.parse(args), signal));
}
