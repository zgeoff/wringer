import { expect, test } from 'bun:test';
import { parseGitHubRepo } from './parse-github-repo.ts';

test.each([
  ['https://github.com/acme/shop.git', 'acme', 'shop'],
  ['https://github.com/acme/shop', 'acme', 'shop'],
  ['https://user:secret@github.com/acme/shop.git', 'acme', 'shop'],
  ['git@github.com:acme/shop.git', 'acme', 'shop'],
  ['ssh://git@github.com/acme/shop.git', 'acme', 'shop'],
  ['acme/shop', 'acme', 'shop'],
])('#parseGitHubRepo reads %s', (text, owner, name) => {
  expect(parseGitHubRepo(text)).toStrictEqual({ owner, name });
});

test.each(['', 'shop', 'https://github.com/acme', 'https://github.com/a/b/c', '/tmp/some/dir/x'])(
  '#parseGitHubRepo returns null for "%s"',
  (text) => {
    expect(parseGitHubRepo(text)).toBeNull();
  },
);
