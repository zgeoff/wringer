import { z } from 'zod';

const refSchema = z.strictObject({ ref: z.string().min(1) });

// The origins a granted write may land on, which the page checks once the element is ready to act
// on, because the tab can navigate while the action waits for it.
const originsShape = { origins: z.array(z.string()).optional() };
const guardedRefSchema = refSchema.extend(originsShape);
const roleSchema = z.strictObject({ role: z.string().min(1), name: z.string(), ...originsShape });

const labelSchema = z.strictObject({
  label: z.string().min(1),
  role: z.string().min(1).optional(),
  ...originsShape,
});

const textSchema = z.strictObject({
  text: z.string().min(1),
  role: z.string().min(1).optional(),
  ...originsShape,
});

const elementSchema = z.union([guardedRefSchema, roleSchema, labelSchema, textSchema]);

export type ElementTarget = z.infer<typeof elementSchema>;

export const pageStateSchema = z.strictObject({
  url: z.string(),
  title: z.string(),
});

// A click or a key press can open a tab, or close the tab it ran on, or start a download, and the
// result says which.
export const actionStateSchema = pageStateSchema.extend({
  openedTab: z.number().int().nonnegative().optional(),
  closedTab: z.number().int().nonnegative().optional(),
  download: z.strictObject({ url: z.string(), fileName: z.string() }).optional(),
});

export const checkStateSchema = actionStateSchema.extend({ checked: z.boolean() });

const tabSchema = z.strictObject({
  index: z.number().int().nonnegative(),
  url: z.string(),
  title: z.string(),
  active: z.boolean(),
});

export const tabsSchema = z.strictObject({ tabs: z.array(tabSchema) });

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
  click: { args: elementSchema, result: actionStateSchema },
  check: { args: elementSchema, result: checkStateSchema },
  uncheck: { args: elementSchema, result: checkStateSchema },
  press: {
    args: z.strictObject({ key: z.string().min(1), element: elementSchema.optional() }),
    result: actionStateSchema,
  },
  hover: { args: elementSchema, result: pageStateSchema },
  tabs: { args: z.null(), result: tabsSchema },
  tab: { args: z.strictObject({ index: z.number().int().nonnegative() }), result: pageStateSchema },
  closeTab: { args: z.null(), result: actionStateSchema },
  activeURL: { args: z.null(), result: z.strictObject({ url: z.string() }) },
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
