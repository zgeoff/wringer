import { expect, test } from 'bun:test';
import { createSecretSet } from '../secrets/create-secret-set.ts';
import { formatReportLink } from './format-report-link.ts';

test.each([
  ['an https link', 'https://files.example/a.png', 'https://files.example/a.png'],
  ['an http link', 'http://files.example/a.png', 'http://files.example/a.png'],
  ['an http link on another host', 'http://other.example/a.png', null],
  ['an https link on another host', 'https://other.example/a.png', null],
  ['an ftp link', 'ftp://files.example/a.png', null],
  ['text that is not a URL', 'not a url', null],
])('it formats %s for the report', (_name, url, expected) => {
  expect(formatReportLink(url, ['files.example'], createSecretSet())).toBe(expected);
});
