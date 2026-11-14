import type { AnyDrivers, DriveContext, DriverClients } from '../types.ts';
import { WringerError } from '../wringer-error.ts';

// Dispatch puts a client for every registered driver in `drivers`, and a target that gives a driver
// no config gets a client that refuses each call, so every name the repo typed is present.
export function toTypedDriveContext<Ds extends AnyDrivers>(
  ctx: DriveContext,
  driverNames: readonly string[],
): DriveContext<Ds> {
  const clients = ctx.drivers;

  if (!hasDriverClients<Ds>(clients, driverNames)) {
    throw new WringerError('internal', { message: 'The drive context lacks a driver client.' });
  }

  return { ...ctx, drivers: clients };
}

function hasDriverClients<Ds extends AnyDrivers>(
  clients: DriveContext['drivers'],
  driverNames: readonly string[],
): clients is DriverClients<Ds> {
  return driverNames.every((name) => Object.hasOwn(clients, name));
}
