import { expect, test } from 'bun:test';
import { extraWordsArg } from './build-positional-args.ts';
import { buildRawArgs } from './build-raw-args.ts';

test('it passes only the arguments the caller gave, so the schema defaults fill the rest', () => {
  const raw = buildRawArgs(
    { sku: { type: 'string' }, count: { type: 'number', default: 1 } },
    { values: { sku: 'mug', count: 1 }, explicit: { sku: true, count: false }, rest: [] },
  );

  expect(raw).toStrictEqual({ sku: 'mug' });
});

test('it adds the words after `--` to the list positional', () => {
  const raw = buildRawArgs(
    {
      host: { type: 'positional' },
      argv: { type: 'positional', multiple: true },
      [extraWordsArg]: { type: 'positional', multiple: true },
    },
    {
      values: { host: 'web-1', argv: ['ls'] },
      explicit: { host: true, argv: true },
      rest: ['-la', '/srv'],
    },
  );

  expect(raw).toStrictEqual({ host: 'web-1', argv: ['ls', '-la', '/srv'] });
});

test('it gives the words after `--` to a list positional that took no other word', () => {
  const raw = buildRawArgs(
    { argv: { type: 'positional', multiple: true } },
    { values: {}, explicit: {}, rest: ['tool', '--human'] },
  );

  expect(raw).toStrictEqual({ argv: ['tool', '--human'] });
});

test('it converts the list words before and after `--` with the list parser', () => {
  const raw = buildRawArgs(
    { sizes: { type: 'positional', multiple: true, parse: Number } },
    { values: { sizes: [1] }, explicit: { sizes: true }, rest: ['2'] },
  );

  expect(raw).toStrictEqual({ sizes: [1, 2] });
});

test('it gives a word after `--` to an unset scalar positional, converted by its parser', () => {
  const raw = buildRawArgs(
    {
      degrees: { type: 'positional', parse: Number },
      [extraWordsArg]: { type: 'positional', multiple: true },
    },
    { values: {}, explicit: {}, rest: ['-15'] },
  );

  expect(raw).toStrictEqual({ degrees: -15 });
});

test('it fills the unset scalar positionals in order before the list takes the other words', () => {
  const raw = buildRawArgs(
    {
      host: { type: 'positional' },
      argv: { type: 'positional', multiple: true },
      [extraWordsArg]: { type: 'positional', multiple: true },
    },
    { values: {}, explicit: {}, rest: ['-web-1', '-la', '/srv'] },
  );

  expect(raw).toStrictEqual({ host: '-web-1', argv: ['-la', '/srv'] });
});

test.each([
  { name: 'a word no positional takes', values: { [extraWordsArg]: ['prod'] }, rest: [] },
  { name: 'a word after `--` with no list positional', values: {}, rest: ['prod'] },
])('it refuses $name', (row) => {
  expect(() =>
    buildRawArgs(
      { [extraWordsArg]: { type: 'positional', multiple: true } },
      { values: row.values, explicit: {}, rest: row.rest },
    ),
  ).toThrow(expect.objectContaining({ code: 'usage' }));
});
