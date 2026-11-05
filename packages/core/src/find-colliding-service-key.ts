import { buildServiceKey } from './build-service-key.ts';

export interface DriverServices {
  readonly name: string;
  readonly serviceNames: readonly string[];
}

// A key that two driver services share, such as `cache/main` with `store` and `cache` with
// `main/store`, or null when each key is unique.
export function findCollidingServiceKey(drivers: readonly DriverServices[]): string | null {
  const keys = drivers.flatMap((driver) =>
    driver.serviceNames.map((service) => buildServiceKey(driver.name, service)),
  );

  return keys.find((key, index) => keys.indexOf(key) !== index) ?? null;
}
