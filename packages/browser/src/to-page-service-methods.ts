import type { ServiceMethod } from '@wringer/core';
import type { z } from 'zod';
import { pageServiceContract } from './page-service-contract.ts';
import type { PageArgs, PageMethod, PageResult } from './page-service-contract.ts';

export type PageHandlers = {
  readonly [Method in PageMethod]: (
    args: PageArgs<Method>,
    signal: AbortSignal,
  ) => Promise<PageResult<Method>>;
};

// Each method parses its request against the contract, so a handler only sees the args the client
// was typed to send, and a bad request rejects before the page acts on it.
export function toPageServiceMethods(
  handlers: PageHandlers,
): Readonly<Record<PageMethod, ServiceMethod>> {
  return {
    goto: bindMethod(pageServiceContract.goto.args, handlers.goto),
    snapshot: bindMethod(pageServiceContract.snapshot.args, handlers.snapshot),
    describe: bindMethod(pageServiceContract.describe.args, handlers.describe),
    click: bindMethod(pageServiceContract.click.args, handlers.click),
    type: bindMethod(pageServiceContract.type.args, handlers.type),
    screenshot: bindMethod(pageServiceContract.screenshot.args, handlers.screenshot),
    status: bindMethod(pageServiceContract.status.args, handlers.status),
  };
}

function bindMethod<Schema extends z.ZodType>(
  schema: Schema,
  handler: (args: z.output<Schema>, signal: AbortSignal) => Promise<unknown>,
): ServiceMethod {
  return (args, signal) => Promise.try(() => handler(schema.parse(args), signal));
}
