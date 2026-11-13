import type { Wringer } from '@wringer/core';
import { buildShopBase } from './build-shop-base.ts';
import type { ShopRegistryOptions } from './build-shop-base.ts';

// wringer's own verify registry: the shop base, driven through each package's real CLI, with one
// feature for each package, the globs that change every feature, and the paths with no runtime
// effect.
export function createWringerRegistry(options: ShopRegistryOptions = {}): Wringer {
  return buildShopBase('wringer', options)
    .feature(
      {
        name: 'browser-driver',
        summary: 'Drive the shop page in a real browser',
        paths: ['packages/browser/package.json', 'packages/browser/src/**'],
      },
      {
        name: 'http-driver',
        summary: 'Send HTTP requests to the app and read the answers',
        paths: ['packages/http/package.json', 'packages/http/src/**'],
      },
      {
        name: 'db-driver',
        summary: 'Query the app database and read the rows',
        paths: ['packages/db/package.json', 'packages/db/src/**'],
      },
      {
        name: 'stream-driver',
        summary: "Read the app's log lines",
        paths: ['packages/stream/package.json', 'packages/stream/src/**'],
      },
      {
        name: 'core',
        summary: 'Run the app, keep each run and its evidence, and report each verdict',
        paths: [
          'packages/core/package.json',
          'packages/core/envelope.schema.json',
          'packages/core/src/**',
          'packages/core/scripts/**',
        ],
      },
      {
        name: 'cli',
        summary: 'Parse the command line and print each envelope',
        paths: ['packages/gunshi/package.json', 'packages/gunshi/src/**'],
        commands: ['features'],
      },
      {
        name: 'guide',
        summary: 'Print the guide for adding a verify CLI, or one of its topics',
        paths: ['packages/gunshi/guide/**'],
        commands: ['guide'],
      },
    )
    .shared('bun.lock', 'package.json', '.bun-version', 'bunfig.toml', 'packages/shop-example/**')
    .ignore(
      '*.md',
      'docs/**',
      '.claude/**',
      '.github/**',
      '.lefthook/**',
      'scripts/**',
      '**/*.test.ts',
      '**/test-utils/**',
      '**/e2e/**',
      'packages/*/README.md',
      'packages/*/CHANGELOG.md',
      'packages/*/LICENSE',
      'packages/*/tsconfig*.json',
      '.editorconfig',
      '.formatignore',
      '.gitignore',
      '.gitleaks.toml',
      '.oxfmtrc.json',
      '.oxlintrc.json',
      '.release-please-manifest.json',
      'LICENSE',
      'audit-ignores.json',
      'commitlint.config.js',
      'knip.json',
      'lefthook.yml',
      'release-please-config.json',
      'renovate.json',
      'review.json',
      'socket.yml',
      'tsconfig*.json',
    )
    .build();
}
