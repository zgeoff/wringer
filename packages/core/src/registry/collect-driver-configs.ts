import type { ConfiguredDriver, DriverConfigContext, TargetDefinition, Wringer } from '../types.ts';
import { WringerError } from '../wringer-error.ts';

export interface ConfiguredEntry {
  readonly name: string;
  readonly serviceNames: readonly string[];
  readonly configured: ConfiguredDriver;
}

// A driver works on a target only when the target gives it a config. The target's config function
// sees the run's endpoints, so the config is built per run.
export function collectDriverConfigs(
  wringer: Wringer,
  target: TargetDefinition,
  ctx: DriverConfigContext,
): readonly ConfiguredEntry[] {
  return wringer.drivers.flatMap((driver) => {
    const build = target.drivers?.[driver.name];

    if (build === undefined) {
      return [];
    }

    const configured = driver.configure(build(ctx));

    if (!configured.ok) {
      throw new WringerError('usage', {
        message: `The ${driver.name} config of target ${ctx.target} is not valid: ${configured.message}`,
      });
    }

    return [
      { name: driver.name, serviceNames: driver.serviceNames, configured: configured.prepared },
    ];
  });
}
