import type { Fence } from '../types.ts';
import { WringerError } from '../wringer-error.ts';
import type { Access } from './host.ts';

export const defaultRefusalHint = 'This target is read-only. Stop and report the write you needed.';

export interface FenceOptions {
  readonly access: Access;
  readonly hint: string;
}

// Default-deny: on a read-only target, every call whose effect is not `read` is refused before it
// runs. The driver states the effect, with the target's grants already applied.
export function makeFence(options: FenceOptions): Fence {
  return (call) => (args) => {
    if (options.access === 'read-only' && call.effect(args) !== 'read') {
      return Promise.reject(
        new WringerError('read-only', {
          message: `${call.describe(args)} is a write, and the target is read-only.`,
          hint: options.hint,
        }),
      );
    }

    return call.run(args);
  };
}
