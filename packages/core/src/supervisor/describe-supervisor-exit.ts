import type { SupervisorExit } from '../types.ts';

export function describeSupervisorExit(exit: SupervisorExit): string {
  return exit.signal === null ? `code ${exit.code}` : `signal ${exit.signal}`;
}
