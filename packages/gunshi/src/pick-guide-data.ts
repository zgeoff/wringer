import { WringerError } from '@wringer/core';
import { z } from 'zod';
import type { GuideTopic } from './parse-guide-topic.ts';

const topicSummarySchema = z.strictObject({ name: z.string(), summary: z.string() });

const topicListSchema = z.strictObject({
  version: z.string(),
  topics: z.array(topicSummarySchema),
});

const topicTextSchema = z.strictObject({
  version: z.string(),
  topic: z.string(),
  text: z.string(),
});

export const guideDataSchema = z.union([topicListSchema, topicTextSchema]);

export type GuideData = z.infer<typeof guideDataSchema>;

export interface Guide {
  readonly version: string;
  readonly topics: readonly GuideTopic[];
}

// With no topic, the list of topics; with one, its text. An unknown topic is a usage error that
// lists the topics, so an agent that guessed a name sees the right ones.
export function pickGuideData(guide: Guide, topic: string | undefined): GuideData | WringerError {
  if (topic === undefined) {
    return {
      version: guide.version,
      topics: guide.topics.map((entry) => ({ name: entry.name, summary: entry.summary })),
    };
  }

  const found = guide.topics.find((candidate) => candidate.name === topic);

  if (found === undefined) {
    return new WringerError('usage', {
      message: `The guide has no topic named ${topic}.`,
      hint: `The topics are ${guide.topics.map((candidate) => candidate.name).join(', ')}.`,
    });
  }

  return { version: guide.version, topic: found.name, text: found.text };
}
