import { findOwnValue } from './find-own-value.ts';
import { supervisorServiceName } from './supervisor-protocol.ts';
import type { SupervisorRequest } from './supervisor-protocol.ts';
import type { ServiceInstance } from './types.ts';
import { WringerError } from './wringer-error.ts';

export type SupervisorOperation =
  | { readonly kind: 'stop' }
  | { readonly kind: 'status' }
  | { readonly kind: 'call'; readonly call: (signal: AbortSignal) => Promise<unknown> }
  | { readonly kind: 'refuse'; readonly error: WringerError };

export function pickSupervisorOperation(
  request: SupervisorRequest,
  services: ReadonlyMap<string, Pick<ServiceInstance, 'methods'>>,
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

  return { kind: 'call', call: (signal) => method(request.args, signal) };
}
