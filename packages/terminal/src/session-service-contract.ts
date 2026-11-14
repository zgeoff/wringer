import { z } from 'zod';

const sessionIDSchema = z.string().min(1).optional();

const matchSchema = z.strictObject({
  row: z.number().int().nonnegative(),
  col: z.number().int().nonnegative(),
});

export const screenSchema = z.strictObject({
  text: z.string(),
  cursor: z.strictObject({
    row: z.number().int().nonnegative(),
    col: z.number().int().nonnegative(),
    visible: z.boolean(),
  }),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});

const sessionOnlySchema = z.strictObject({ session: z.string() });

export const sessionInfoSchema = z.strictObject({
  session: z.string(),
  program: z.string(),
  pid: z.number().int(),
  running: z.boolean(),
  exitCode: z.number().int().nullable(),
});

// The sessions service crosses from the CLI to the run's supervisor as untyped JSON, so the client
// parses each answer and the supervisor parses each request against this one table.
export const sessionServiceContract = {
  start: {
    args: z.strictObject({ program: z.string().min(1) }),
    result: z.strictObject({ session: z.string(), pid: z.number().int() }),
  },
  type: {
    args: z.strictObject({ session: sessionIDSchema, text: z.string() }),
    result: sessionOnlySchema,
  },
  press: {
    args: z.strictObject({ session: sessionIDSchema, keys: z.array(z.string().min(1)).min(1) }),
    result: sessionOnlySchema,
  },
  wait: {
    args: z.strictObject({
      session: sessionIDSchema,
      text: z.string().min(1).optional(),
      regex: z.string().min(1).optional(),
      timeoutMs: z.number().int().positive(),
    }),
    result: z.strictObject({
      session: z.string(),
      match: matchSchema.nullable(),
      screen: screenSchema,
    }),
  },
  screen: {
    args: z.strictObject({ session: sessionIDSchema }),
    result: z.strictObject({ session: z.string(), screen: screenSchema }),
  },
  stop: {
    args: z.strictObject({ session: sessionIDSchema }),
    result: z.strictObject({ session: z.string(), exitCode: z.number().int() }),
  },
  list: {
    args: z.null(),
    result: z.strictObject({ sessions: z.array(sessionInfoSchema) }),
  },
};

type SessionServiceContract = typeof sessionServiceContract;

export type SessionMethod = keyof SessionServiceContract;

export type SessionArgs<Method extends SessionMethod> = z.output<
  SessionServiceContract[Method]['args']
>;

export type SessionResult<Method extends SessionMethod> = z.output<
  SessionServiceContract[Method]['result']
>;
