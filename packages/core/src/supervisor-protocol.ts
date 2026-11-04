import { z } from 'zod';
import { envelopeErrorSchema } from './envelope.ts';

// One request per connection, one JSON line each way, so a crashed command never leaves a
// half-read stream on the supervisor's socket.
export const supervisorRequestSchema = z.strictObject({
  service: z.string(),
  method: z.string(),
  args: z.unknown(),
});

export type SupervisorRequest = z.infer<typeof supervisorRequestSchema>;

export const supervisorResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), result: z.unknown() }),
  z.strictObject({ ok: z.literal(false), error: envelopeErrorSchema }),
]);

export type SupervisorResponse = z.infer<typeof supervisorResponseSchema>;

export const supervisorServiceName = 'supervisor';
export const supervisorCommandName = '__wringer-supervisor';
