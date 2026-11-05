import { expect, test } from 'bun:test';
import { findLeadingWord } from './find-leading-word.ts';
import { parseSQLTokens } from './parse-sql-tokens.ts';

test.each([
  { sql: 'select id from orders', word: 'select' },
  { sql: '  -- open orders\n(SELECT id from orders)', word: 'select' },
  { sql: '/* tidy */ insert into notes values (1)', word: 'insert' },
  { sql: '/* a /* nested */ note */ delete from notes', word: 'delete' },
  { sql: 'Show server_version', word: 'show' },
  { sql: "'select'", word: null },
  { sql: '-- only a comment', word: null },
  { sql: '', word: null },
] as const)('it finds $word as the leading word of `$sql`', (row) => {
  expect(findLeadingWord(parseSQLTokens('postgres', row.sql).tokens)).toBe(row.word);
});
