import type { ServiceMethod } from '@wringer/core';
import type { z } from 'zod';
import { sessionServiceContract } from '../session-service-contract.ts';
import type { SessionArgs, SessionMethod, SessionResult } from '../session-service-contract.ts';

export type SessionHandlers = {
  readonly [Method in SessionMethod]: (
    args: SessionArgs<Method>,
    signal: AbortSignal,
  ) => Promise<SessionResult<Method>>;
};

// Each method parses its request against the contract, so a handler only sees the args the client
// was typed to send.
export function toSessionServiceMethods(
  handlers: SessionHandlers,
): Readonly<Record<SessionMethod, ServiceMethod>> {
  return {
    start: bindMethod(sessionServiceContract.start.args, handlers.start),
    type: bindMethod(sessionServiceContract.type.args, handlers.type),
    press: bindMethod(sessionServiceContract.press.args, handlers.press),
    wait: bindMethod(sessionServiceContract.wait.args, handlers.wait),
    screen: bindMethod(sessionServiceContract.screen.args, handlers.screen),
    stop: bindMethod(sessionServiceContract.stop.args, handlers.stop),
    list: bindMethod(sessionServiceContract.list.args, handlers.list),
  };
}

function bindMethod<Schema extends z.ZodType>(
  schema: Schema,
  handler: (args: z.output<Schema>, signal: AbortSignal) => Promise<unknown>,
): ServiceMethod {
  return (args, signal) => Promise.try(() => handler(schema.parse(args), signal));
}
