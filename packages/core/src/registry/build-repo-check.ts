import type { AnyDrivers, CheckDefinition, RunnableRepoCheck } from '../types.ts';
import { toTypedDriveContext } from './to-typed-drive-context.ts';

export function buildRepoCheck<Input, Data, Ds extends AnyDrivers>(
  check: CheckDefinition<Input, Data, Ds>,
  driverNames: readonly string[],
): RunnableRepoCheck {
  return {
    name: check.name,
    timeoutMs: check.timeoutMs,
    run: async (ctx) => {
      const typed = toTypedDriveContext<Ds>(ctx, driverNames);

      const data = await check.run(check.input.parse({}), typed);

      check.data.parse(data);
    },
  };
}
