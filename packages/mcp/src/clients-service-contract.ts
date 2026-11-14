import { z } from 'zod';

const secretSchema = z.strictObject({ name: z.string(), value: z.string() });

export const toolInfoSchema = z.strictObject({
  name: z.string(),
  description: z.string(),
  readOnlyHint: z.boolean().nullable(),
  inReadTools: z.boolean(),
});

export const contentSchema = z.array(z.looseObject({ type: z.string() }));
export const structuredContentSchema = z.record(z.string(), z.unknown()).nullable();

// The clients service crosses from the CLI to the run's supervisor as untyped JSON, so each side
// parses against this table. Each answer carries the secrets the service met, for the command to
// add to its set before it writes evidence.
export const clientsServiceContract = {
  tools: {
    args: z.strictObject({ server: z.string() }),
    result: z.strictObject({
      server: z.string(),
      tools: z.array(toolInfoSchema),
      secrets: z.array(secretSchema),
    }),
  },
  call: {
    args: z.strictObject({
      server: z.string(),
      tool: z.string().min(1),
      args: z.record(z.string(), z.unknown()),
    }),
    result: z.strictObject({
      server: z.string(),
      tool: z.string(),
      isError: z.boolean(),
      content: contentSchema,
      structuredContent: structuredContentSchema,
      secrets: z.array(secretSchema),
    }),
  },
};

type ClientsServiceContract = typeof clientsServiceContract;

export type ClientsMethod = keyof ClientsServiceContract;

export type ClientsArgs<Method extends ClientsMethod> = z.output<
  ClientsServiceContract[Method]['args']
>;

export type ClientsResult<Method extends ClientsMethod> = z.output<
  ClientsServiceContract[Method]['result']
>;
