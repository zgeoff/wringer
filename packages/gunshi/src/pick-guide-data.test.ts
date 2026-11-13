import { expect, test } from 'bun:test';
import { WringerError } from '@wringer/core';
import { pickGuideData } from './pick-guide-data.ts';

function setupTest() {
  return {
    guide: {
      version: '1.2.3',
      topics: [
        { name: 'brew', summary: 'Make tea', text: '# Brew\n\nMake tea\n' },
        { name: 'pour', summary: 'Pour tea', text: '# Pour\n\nPour tea\n' },
      ],
    },
  };
}

test('it lists the topics and the version when no topic is given', () => {
  const ctx = setupTest();

  expect(pickGuideData(ctx.guide, undefined)).toStrictEqual({
    version: '1.2.3',
    topics: [
      { name: 'brew', summary: 'Make tea' },
      { name: 'pour', summary: 'Pour tea' },
    ],
  });
});

test('it returns the text of the topic with the version', () => {
  const ctx = setupTest();

  expect(pickGuideData(ctx.guide, 'pour')).toStrictEqual({
    version: '1.2.3',
    topic: 'pour',
    text: '# Pour\n\nPour tea\n',
  });
});

test('it refuses an unknown topic with a usage error that lists the topics', () => {
  const ctx = setupTest();
  const result = pickGuideData(ctx.guide, 'nope');

  expect(result).toBeInstanceOf(WringerError);
  expect(result).toMatchObject({ code: 'usage', hint: 'The topics are brew, pour.' });
});
