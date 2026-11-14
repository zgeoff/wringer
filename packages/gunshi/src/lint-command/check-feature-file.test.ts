import { expect, test } from 'bun:test';
import { checkFeatureFile } from './check-feature-file.ts';

test('it returns nothing for a file with both sections and the use line first', () => {
  const text = [
    '# brew',
    '',
    '## Journey',
    '',
    '```bash',
    '$ bun verify use --feature brew',
    'bun verify kettle fill',
    '```',
    '',
    '## End state',
    '',
    '- The pot is full.',
  ].join('\n');

  expect(checkFeatureFile(text, 'brew', ['bun', 'verify'])).toStrictEqual([]);
});

test('it ignores a heading inside a code block', () => {
  const text = ['# brew', '', '```md', '## Journey', '## End state', '```'].join('\n');

  expect(checkFeatureFile(text, 'brew', null).map((found) => found.line)).toStrictEqual([1, 1]);
});

test('it skips the use line check when the command words are unknown', () => {
  const text = '## Journey\n\n```bash\nwhatever\n```\n\n## End state\n';

  expect(checkFeatureFile(text, 'brew', null)).toStrictEqual([]);
});

test('it takes the first bash block of the Journey, not an earlier text block', () => {
  const text = [
    '## Journey',
    '',
    '```text',
    'noise',
    '```',
    '',
    '```bash',
    'bun verify use --feature steep',
    '```',
    '',
    '## End state',
  ].join('\n');

  expect(checkFeatureFile(text, 'brew', ['bun', 'verify'])).toStrictEqual([
    {
      line: 8,
      problem:
        "The first line of the Journey's first `bash` block is `bun verify use --feature steep`, and it must be `bun verify use --feature brew`.",
    },
  ]);
});
