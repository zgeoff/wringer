import { z } from 'zod';
import { envelopeErrorSchema } from './envelope.ts';
import { runIDSchema } from './run-events.ts';

// One request per connection, one JSON line each way, so a crashed command never leaves a
// half-read stream on the supervisor's socket.
export const supervisorRequestSchema = z.strictObject({
  service: z.string(),
  method: z.string(),
  args: z.unknown(),

  // The caller's deadline, in ms since the epoch. A call to the supervisor itself has none.
  deadlineAt: z.number().optional(),
});

export type SupervisorRequest = z.infer<typeof supervisorRequestSchema>;

export const supervisorResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), result: z.unknown() }),
  z.strictObject({ ok: z.literal(false), error: envelopeErrorSchema }),
]);

export type SupervisorResponse = z.infer<typeof supervisorResponseSchema>;

export const supervisorServiceName = 'supervisor';
export const supervisorCommandName = '__wringer-supervisor';

// The arguments after the hidden command name, which the starter writes and the supervisor
// process parses.
export const supervisorArgsSchema = z
  .tuple([runIDSchema, z.string().min(1), z.string().min(1)])
  .transform(([runID, target, root]) => ({ runID, target, root }));

export interface SupervisorArgvInput {
  readonly runID: string;
  readonly target: string;
  readonly root: string;
}

export function buildSupervisorArgv(args: SupervisorArgvInput): readonly string[] {
  return [supervisorCommandName, args.runID, args.target, args.root];
}
