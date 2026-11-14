import { expect, test } from 'bun:test';
import { parseGuideTopic } from './parse-guide-topic.ts';

test('it takes the paragraph after the title as the summary', () => {
  const text = '# Brew\n\nMake a pot of tea\n\nBody of the topic.\n';

  expect(parseGuideTopic('brew', text)).toStrictEqual({
    name: 'brew',
    summary: 'Make a pot of tea',
    text,
  });
});

test('it joins a summary that wraps over two lines', () => {
  expect(parseGuideTopic('brew', '# Brew\n\nMake a pot\nof tea\n\nBody\n').summary).toBe(
    'Make a pot of tea',
  );
});

test('it gives an empty summary to a topic that has only a title', () => {
  expect(parseGuideTopic('brew', '# Brew\n').summary).toBe('');
});
