import { findOwnValue } from './find-own-value.ts';
import { supervisorServiceName } from './supervisor-protocol.ts';
import type { SupervisorRequest } from './supervisor-protocol.ts';
import type { ServiceInstance } from './types.ts';
import { WringerError } from './wringer-error.ts';

export type SupervisorOperation =
  | { readonly kind: 'stop' }
  | { readonly kind: 'status' }
  | {
      readonly kind: 'call';

      // Empty for a request with no deadline; otherwise the one delay after which the call aborts.
      readonly cancelAfterMs: readonly number[];
      readonly call: (signal: AbortSignal) => Promise<unknown>;
    }
  | { readonly kind: 'refuse'; readonly error: WringerError };

// A service method's signal aborts this long before the caller's deadline, so the method has time
// to stop its work, such as a browser closing its page, before the caller reports a timeout.
const serviceCancelReserveMs = 1000;

export function pickSupervisorOperation(
  request: SupervisorRequest,
  services: ReadonlyMap<string, Pick<ServiceInstance, 'methods'>>,
  nowMs: number,
): SupervisorOperation {
  if (request.service === supervisorServiceName) {
    return request.method === 'stop' ? { kind: 'stop' } : { kind: 'status' };
  }

  const methods = services.get(request.service)?.methods ?? {};
  const method = findOwnValue(methods, request.method);

  if (method === undefined) {
    return {
      kind: 'refuse',
      error: new WringerError('usage', {
        message: `The run has no service call ${request.service} ${request.method}.`,
      }),
    };
  }

  return {
    kind: 'call',
    cancelAfterMs:
      request.deadlineAt === undefined
        ? []
        : [Math.max(0, request.deadlineAt - serviceCancelReserveMs - nowMs)],
    call: (signal) => method(request.args, signal),
  };
}
