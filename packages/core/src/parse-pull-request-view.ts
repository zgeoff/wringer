import { z } from 'zod';
import type { PullRequestView } from './types.ts';

const pullRequestSchema = z.object({
  number: z.number().int(),
  html_url: z.string(),
  body: z.string().nullable(),
  base: z.object({ ref: z.string() }),
  state: z.enum(['open', 'closed']),
  merged_at: z.string().nullable().optional(),
});

// Reads one pull request from GitHub's JSON. Returns null for a shape this code does not know.
export function parsePullRequestView(value: unknown): PullRequestView | null {
  const parsed = pullRequestSchema.safeParse(value);

  if (!parsed.success) {
    return null;
  }

  const pr = parsed.data;

  return {
    number: pr.number,
    url: pr.html_url,
    body: pr.body ?? '',
    baseBranch: pr.base.ref,
    state: pr.merged_at === null || pr.merged_at === undefined ? pr.state : 'merged',
  };
}
