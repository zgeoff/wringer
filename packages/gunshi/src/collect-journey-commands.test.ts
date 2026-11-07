import { expect, test } from 'bun:test';
import { collectJourneyCommands } from './collect-journey-commands.ts';

test('it collects each line of a code block that calls the CLI, with its line number', () => {
  const text = [
    '# Tea timer',
    '',
    'Run `bun verify up` first.',
    '',
    '```bash',
    'bun verify up',
    'bun verify action brew --minutes 4',
    '```',
  ].join('\n');

  expect(
    collectJourneyCommands([{ path: 'skill/SKILL.md', text }], ['bun', 'verify']),
  ).toStrictEqual([
    { path: 'skill/SKILL.md', line: 6, text: 'bun verify up', argv: ['up'] },
    {
      path: 'skill/SKILL.md',
      line: 7,
      text: 'bun verify action brew --minutes 4',
      argv: ['action', 'brew', '--minutes', '4'],
    },
  ]);
});

test('it skips a code block line that runs another program', () => {
  const text = ['```sh', 'git status', 'bun test', '```'].join('\n');

  expect(collectJourneyCommands([{ path: 'SKILL.md', text }], ['bun', 'verify'])).toStrictEqual([]);
});

test('it reads a line with a prompt and an environment assignment', () => {
  const text = [
    '```sh',
    '$ KETTLE_URL=http://127.0.0.1:4100 bun verify attach --target shared',
    '```',
  ].join('\n');

  expect(collectJourneyCommands([{ path: 'SKILL.md', text }], ['bun', 'verify'])).toStrictEqual([
    {
      path: 'SKILL.md',
      line: 2,
      text: 'KETTLE_URL=http://127.0.0.1:4100 bun verify attach --target shared',
      argv: ['attach', '--target', 'shared'],
    },
  ]);
});

test('it joins a line that ends in a backslash to the next', () => {
  const text = ['```sh', 'bun verify action brew \\', '  --minutes 4', '```'].join('\n');

  expect(collectJourneyCommands([{ path: 'SKILL.md', text }], ['bun', 'verify'])).toStrictEqual([
    {
      path: 'SKILL.md',
      line: 2,
      text: 'bun verify action brew   --minutes 4',
      argv: ['action', 'brew', '--minutes', '4'],
    },
  ]);
});

test('it keeps a tilde block open past a backtick fence inside it', () => {
  const text = ['~~~markdown', '```sh', 'bun verify up', '```', '~~~'].join('\n');

  expect(collectJourneyCommands([{ path: 'SKILL.md', text }], ['bun', 'verify'])).toStrictEqual([
    { path: 'SKILL.md', line: 3, text: 'bun verify up', argv: ['up'] },
  ]);
});

test('it keeps a block open past a fence line that carries an info string', () => {
  const text = ['```', '```ts', 'bun verify wave', '```'].join('\n');

  expect(collectJourneyCommands([{ path: 'SKILL.md', text }], ['bun', 'verify'])).toStrictEqual([
    { path: 'SKILL.md', line: 3, text: 'bun verify wave', argv: ['wave'] },
  ]);
});

test('it closes a block on a longer run of its fence marker', () => {
  const text = ['```sh', 'bun verify up', '`````', 'bun verify down', '```'].join('\n');

  expect(collectJourneyCommands([{ path: 'SKILL.md', text }], ['bun', 'verify'])).toStrictEqual([
    { path: 'SKILL.md', line: 2, text: 'bun verify up', argv: ['up'] },
  ]);
});

test('it keeps a continued line that the closing fence ends', () => {
  const text = ['```sh', 'bun verify up \\', '```'].join('\n');

  expect(collectJourneyCommands([{ path: 'SKILL.md', text }], ['bun', 'verify'])).toStrictEqual([
    { path: 'SKILL.md', line: 2, text: 'bun verify up', argv: ['up'] },
  ]);
});

test('it gives a null argv for a CLI line with an unclosed quote', () => {
  const text = ['```sh', `bun verify use --label 'open`, '```'].join('\n');

  expect(collectJourneyCommands([{ path: 'SKILL.md', text }], ['bun', 'verify'])).toStrictEqual([
    { path: 'SKILL.md', line: 2, text: `bun verify use --label 'open`, argv: null },
  ]);
});

test('it joins a CLI line whose quote stays open to the lines that close it', () => {
  const text = ['```sh', `bun verify db query 'select *`, `from orders'`, '```'].join('\n');

  expect(collectJourneyCommands([{ path: 'SKILL.md', text }], ['bun', 'verify'])).toStrictEqual([
    {
      path: 'SKILL.md',
      line: 2,
      text: `bun verify db query 'select *\nfrom orders'`,
      argv: ['db', 'query', 'select *\nfrom orders'],
    },
  ]);
});

test('it skips prose in a code block that names the CLI after an apostrophe', () => {
  const text = ['```text', `Don't run bun verify up twice.`, 'bun verify down', '```'].join('\n');

  expect(collectJourneyCommands([{ path: 'SKILL.md', text }], ['bun', 'verify'])).toStrictEqual([
    { path: 'SKILL.md', line: 3, text: 'bun verify down', argv: ['down'] },
  ]);
});

test('it joins a continued line in a file with Windows line endings', () => {
  const text = ['```sh', 'bun verify action brew \\', '  --minutes 4', '```'].join('\r\n');

  expect(collectJourneyCommands([{ path: 'SKILL.md', text }], ['bun', 'verify'])).toStrictEqual([
    {
      path: 'SKILL.md',
      line: 2,
      text: 'bun verify action brew   --minutes 4',
      argv: ['action', 'brew', '--minutes', '4'],
    },
  ]);
});

test('it joins a backslash-continued word with no space between its halves', () => {
  const text = ['```sh', 'bun verify action greet --name Wr\\', 'en', '```'].join('\n');

  expect(collectJourneyCommands([{ path: 'SKILL.md', text }], ['bun', 'verify'])).toStrictEqual([
    {
      path: 'SKILL.md',
      line: 2,
      text: 'bun verify action greet --name Wren',
      argv: ['action', 'greet', '--name', 'Wren'],
    },
  ]);
});

test('it ends a line with an open quote at the next CLI line', () => {
  const text = [
    '```sh',
    `bun verify action greet --name O'Brien`,
    `bun verify action greet --name D'Arcy`,
    '```',
  ].join('\n');

  expect(collectJourneyCommands([{ path: 'SKILL.md', text }], ['bun', 'verify'])).toStrictEqual([
    { path: 'SKILL.md', line: 2, text: `bun verify action greet --name O'Brien`, argv: null },
    { path: 'SKILL.md', line: 3, text: `bun verify action greet --name D'Arcy`, argv: null },
  ]);
});

test('it keeps an open-quote line in a fence that runs to the end of the file', () => {
  const text = ['```sh', `bun verify use --label 'open`].join('\n');

  expect(collectJourneyCommands([{ path: 'SKILL.md', text }], ['bun', 'verify'])).toStrictEqual([
    { path: 'SKILL.md', line: 2, text: `bun verify use --label 'open`, argv: null },
  ]);
});

test('it joins an open quote after an assignment whose value is quoted', () => {
  const text = [
    '```sh',
    `NOTE='two words' bun verify db query 'select *`,
    `from orders'`,
    '```',
  ].join('\n');

  expect(collectJourneyCommands([{ path: 'SKILL.md', text }], ['bun', 'verify'])).toStrictEqual([
    {
      path: 'SKILL.md',
      line: 2,
      text: `NOTE='two words' bun verify db query 'select *\nfrom orders'`,
      argv: ['db', 'query', 'select *\nfrom orders'],
    },
  ]);
});

test('it ignores a CLI call outside a code block', () => {
  const text = 'bun verify up\n';

  expect(collectJourneyCommands([{ path: 'SKILL.md', text }], ['bun', 'verify'])).toStrictEqual([]);
});
