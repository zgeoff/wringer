import { expect, test } from 'bun:test';
import { parseSQLTokens } from './parse-sql-tokens.ts';

test.each([
  {
    name: 'a nested block comment as one comment',
    sql: "/* /* */ ' */ do",
    tokens: [{ kind: 'word', text: 'do' }],
  },
  {
    name: 'a line comment up to the end of its line',
    sql: '-- note\nselect',
    tokens: [{ kind: 'word', text: 'select' }],
  },
  {
    name: 'a doubled quote inside a string',
    sql: "'it''s'",
    tokens: [{ kind: 'string', text: "it's" }],
  },
  {
    name: 'a comment marker inside a string as text',
    sql: "'/* -- '",
    tokens: [{ kind: 'string', text: '/* -- ' }],
  },
  {
    name: 'a quoted name',
    sql: '"lo_export"',
    tokens: [{ kind: 'name', text: 'lo_export', escaped: false }],
  },
  {
    name: 'a name in unicode escapes',
    sql: String.raw`U&"\006Co"`,
    tokens: [{ kind: 'name', text: String.raw`\006Co`, escaped: true }],
  },
  {
    name: 'a backslash-escaped quote inside an E string',
    sql: String.raw`E'it\'s' x`,
    tokens: [
      { kind: 'string', text: String.raw`it\'s` },
      { kind: 'word', text: 'x' },
    ],
  },
  {
    name: 'a tagged dollar-quoted body with a quote and a comment marker inside',
    sql: "$fn$ ' /* $fn$ do",
    tokens: [
      { kind: 'string', text: " ' /* " },
      { kind: 'word', text: 'do' },
    ],
  },
  {
    name: 'a parameter as a symbol and a number',
    sql: '$1',
    tokens: [
      { kind: 'symbol', text: '$' },
      { kind: 'symbol', text: '1' },
    ],
  },
  {
    name: 'a word with a dollar sign inside it',
    sql: 'price$usd',
    tokens: [{ kind: 'word', text: 'price$usd' }],
  },
] as const)('it reads $name on postgres', (row) => {
  expect(parseSQLTokens('postgres', row.sql)).toStrictEqual({ tokens: row.tokens, closed: true });
});

test.each([
  {
    name: 'a block comment that ends at its first close',
    sql: '/* /* */ attach',
    tokens: [{ kind: 'word', text: 'attach' }],
  },
  {
    name: 'a backtick name and a bracket name',
    sql: '`vacuum` [query_only]',
    tokens: [
      { kind: 'name', text: 'vacuum', escaped: false },
      { kind: 'name', text: 'query_only', escaped: false },
    ],
  },
  {
    name: 'a dollar sign as a symbol',
    sql: '$x',
    tokens: [
      { kind: 'symbol', text: '$' },
      { kind: 'word', text: 'x' },
    ],
  },
] as const)('it reads $name on sqlite', (row) => {
  expect(parseSQLTokens('sqlite', row.sql)).toStrictEqual({ tokens: row.tokens, closed: true });
});

test.each([
  {
    dialect: 'postgres',
    newline: 'LF',
    sql: '-- note\ndelete',
    tokens: [{ kind: 'word', text: 'delete' }],
  },
  {
    dialect: 'postgres',
    newline: 'CRLF',
    sql: '-- note\r\ndelete',
    tokens: [{ kind: 'word', text: 'delete' }],
  },
  {
    dialect: 'postgres',
    newline: 'CR',
    sql: '-- note\rdelete',
    tokens: [{ kind: 'word', text: 'delete' }],
  },
  { dialect: 'postgres', newline: 'no newline', sql: '-- note delete', tokens: [] },
  {
    dialect: 'sqlite',
    newline: 'LF',
    sql: '-- note\ndelete',
    tokens: [{ kind: 'word', text: 'delete' }],
  },
  {
    dialect: 'sqlite',
    newline: 'CRLF',
    sql: '-- note\r\ndelete',
    tokens: [{ kind: 'word', text: 'delete' }],
  },
  { dialect: 'sqlite', newline: 'CR', sql: '-- note\rdelete', tokens: [] },
  { dialect: 'sqlite', newline: 'no newline', sql: '-- note delete', tokens: [] },
] as const)('it ends a line comment on $dialect at $newline as the database does', (row) => {
  expect(parseSQLTokens(row.dialect, row.sql)).toStrictEqual({ tokens: row.tokens, closed: true });
});

test.each([
  {
    dialect: 'postgres',
    name: 'a line comment marker and a CR inside a string',
    sql: "'-- x\r' delete",
    tokens: [
      { kind: 'string', text: '-- x\r' },
      { kind: 'word', text: 'delete' },
    ],
  },
  {
    dialect: 'postgres',
    name: 'a line comment marker and a CR inside a dollar-quoted body',
    sql: '$$-- x\r$$ delete',
    tokens: [
      { kind: 'string', text: '-- x\r' },
      { kind: 'word', text: 'delete' },
    ],
  },
  {
    dialect: 'postgres',
    name: 'a CR inside a nested block comment',
    sql: '/* a /* -- \r */ b */ delete',
    tokens: [{ kind: 'word', text: 'delete' }],
  },
  {
    dialect: 'sqlite',
    name: 'a line comment marker inside a bracket name',
    sql: '[-- x] delete',
    tokens: [
      { kind: 'name', text: '-- x', escaped: false },
      { kind: 'word', text: 'delete' },
    ],
  },
] as const)('it reads $name on $dialect', (row) => {
  expect(parseSQLTokens(row.dialect, row.sql)).toStrictEqual({ tokens: row.tokens, closed: true });
});

test.each([
  { dialect: 'postgres', sql: "select 'unclosed" },
  { dialect: 'postgres', sql: 'select /* a /* b */ still open' },
  { dialect: 'postgres', sql: 'select $$ body' },
  { dialect: 'postgres', sql: 'select "name' },
  { dialect: 'sqlite', sql: 'select [name' },
] as const)('it marks `$sql` on $dialect as not closed', (row) => {
  expect(parseSQLTokens(row.dialect, row.sql).closed).toBe(false);
});
