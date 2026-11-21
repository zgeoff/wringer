import { expect, test } from 'bun:test';
import { formatSupervisorExit } from './format-supervisor-exit.ts';

test.each([
  {
    name: 'an exit code',
    exit: { code: 7, signal: null },
    log: 'boom\n',
    expected:
      'the supervisor exited with code 7 before the run was ready; the end of its log:\nboom',
  },
  {
    name: 'a signal',
    exit: { code: null, signal: 'SIGKILL' },
    log: 'boom\n',
    expected:
      'the supervisor exited with signal SIGKILL before the run was ready; the end of its log:\nboom',
  },
  {
    name: 'an empty log',
    exit: { code: 1, signal: null },
    log: '',
    expected: `the supervisor exited with code 1 before the run was ready; its log is empty`,
  },
  {
    name: 'a log of blank lines only',
    exit: { code: 1, signal: null },
    log: '\n  \n\n',
    expected: `the supervisor exited with code 1 before the run was ready; its log is empty`,
  },
  {
    name: 'more than 10 lines, keeping the last 10 non-empty ones',
    exit: { code: 1, signal: null },
    log: Array.from({ length: 12 }, (_, index) => `line ${index + 1}\n\n`).join(''),
    expected: `the supervisor exited with code 1 before the run was ready; the end of its log:\n${Array.from({ length: 10 }, (_, index) => `line ${index + 3}`).join('\n')}`,
  },
  {
    name: 'a line over 300 characters',
    exit: { code: 1, signal: null },
    log: `${'x'.repeat(301)}\n`,
    expected: `the supervisor exited with code 1 before the run was ready; the end of its log:\n${'x'.repeat(300)}...`,
  },
  {
    name: 'a line of exactly 300 characters',
    exit: { code: 1, signal: null },
    log: `${'x'.repeat(300)}\n`,
    expected: `the supervisor exited with code 1 before the run was ready; the end of its log:\n${'x'.repeat(300)}`,
  },
  {
    name: 'URL credentials in a line',
    exit: { code: 1, signal: null },
    log: 'cannot reach postgres://admin:s3cret@db.local:5432/app\n',
    expected: `the supervisor exited with code 1 before the run was ready; the end of its log:\ncannot reach postgres://[redacted]@db.local:5432/app`,
  },
  {
    name: 'a URL without credentials',
    exit: { code: 1, signal: null },
    log: 'cannot reach https://db.local/app\n',
    expected: `the supervisor exited with code 1 before the run was ready; the end of its log:\ncannot reach https://db.local/app`,
  },
  {
    name: 'a tail over 2000 characters, dropping the oldest lines first',
    exit: { code: 1, signal: null },
    log: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
      .map((letter) => `${letter.repeat(299)}\n`)
      .join(''),
    expected: `the supervisor exited with code 1 before the run was ready; the end of its log:\n${[
      'c',
      'd',
      'e',
      'f',
      'g',
      'h',
    ]
      .map((letter) => letter.repeat(299))
      .join('\n')}`,
  },
])('it formats $name', (row) => {
  expect(formatSupervisorExit(row.exit, row.log)).toBe(row.expected);
});
