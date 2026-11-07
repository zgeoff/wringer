// A service is keyed `<driver>/<service>`, so two drivers can each run a service of one name.
export function buildServiceKey(driver: string, service: string): string {
  return `${driver}/${service}`;
}
