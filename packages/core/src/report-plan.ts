import { z } from 'zod';

// How many of each cut a size plan took.
export const reportCutsSchema = z.strictObject({
  droppedData: z.number().int().nonnegative(),
  collapsed: z.number().int().nonnegative(),
  shortCells: z.number().int().nonnegative(),
  omitted: z.number().int().nonnegative(),
});

export type ReportCuts = z.infer<typeof reportCutsSchema>;

// The cuts one feature's journey section takes. A step is named by its index in the journey.
export interface FeaturePlan {
  readonly omitted: boolean;
  readonly collapsed: boolean;
  readonly droppedData: ReadonlySet<number>;
  readonly shortCells: ReadonlySet<number>;
}

// What the renderer cuts from the report, by feature name.
export interface ReportPlan {
  readonly cuts: ReportCuts;
  readonly features: ReadonlyMap<string, FeaturePlan>;
}

export const noCuts: ReportPlan = {
  cuts: { droppedData: 0, collapsed: 0, shortCells: 0, omitted: 0 },
  features: new Map(),
};
