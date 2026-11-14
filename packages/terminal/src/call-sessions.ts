import type { ServiceCaller } from '@wringer/core';
import type { z } from 'zod';
import { sessionServiceContract } from './session-service-contract.ts';
import type { SessionArgs, SessionMethod, SessionResult } from './session-service-contract.ts';

// Indexing this mapped type by a method keeps that method's result type, which indexing the
// contract's own type loses to a union of every result.
type SessionResultSchemas = {
  readonly [Method in SessionMethod]: { readonly result: z.ZodType<SessionResult<Method>> };
};

const resultSchemas: SessionResultSchemas = sessionServiceContract;

export async function callSessions<Method extends SessionMethod>(
  sessions: ServiceCaller,
  method: Method,
  args: SessionArgs<Method>,
): Promise<SessionResult<Method>> {
  const answer = await sessions.call(method, args);

  return resultSchemas[method].result.parse(answer);
}
