import { z } from 'zod';

const refSchema = z.strictObject({ ref: z.string().min(1) });
const roleSchema = z.strictObject({ role: z.string().min(1), name: z.string() });
const elementSchema = z.union([refSchema, roleSchema]);

export type ElementTarget = z.infer<typeof elementSchema>;

export const pageStateSchema = z.strictObject({
  url: z.string(),
  title: z.string(),
});

export const snapshotSchema = z.strictObject({
  url: z.string(),
  title: z.string(),
  snapshot: z.string(),
});

// The page service crosses from the CLI to the run's supervisor as untyped JSON, so the client
// parses each answer and the supervisor parses each request against this one table.
export const pageServiceContract = {
  goto: {
    args: z.strictObject({ url: z.url({ protocol: /^https?$/v }) }),
    result: pageStateSchema,
  },
  snapshot: { args: z.null(), result: snapshotSchema },
  describe: {
    args: refSchema,
    result: z.strictObject({ ref: z.string(), role: z.string(), name: z.string() }),
  },
  click: { args: elementSchema, result: pageStateSchema },
  type: {
    args: z.strictObject({ element: elementSchema, value: z.string() }),
    result: pageStateSchema,
  },
  screenshot: { args: z.null(), result: z.strictObject({ png: z.string() }) },
  status: { args: z.null(), result: z.strictObject({ connected: z.boolean() }) },
};

type PageServiceContract = typeof pageServiceContract;

export type PageMethod = keyof PageServiceContract;

export type PageArgs<Method extends PageMethod> = z.output<PageServiceContract[Method]['args']>;

export type PageResult<Method extends PageMethod> = z.output<PageServiceContract[Method]['result']>;
