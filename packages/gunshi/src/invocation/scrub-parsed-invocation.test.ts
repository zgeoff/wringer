import { expect, test } from 'bun:test';
import { WringerError } from '@wringer/core';
import { createDemoWringer } from '../test-utils/create-demo-wringer.ts';
import { scrubParsedInvocation } from './scrub-parsed-invocation.ts';

function setupTest() {
  const wringer = { ...createDemoWringer(), secrets: ['SHOP_API_TOKEN', 'SHOP_DB_TOKEN'] };

  const failed = {
    kind: 'failed',
    command: 'planted-github-token',
    error: new WringerError('usage', {
      message: 'Command not found: planted-github-token',
      hint: 'Run `help` for planted-github-token',
    }),
  } as const;

  return { wringer, failed };
}

test('#scrubParsedInvocation scrubs the command and the error of a parse failure', () => {
  const ctx = setupTest();

  const scrubbed = scrubParsedInvocation(ctx.failed, ctx.wringer, {
    GITHUB_TOKEN: 'planted-github-token',
  });

  expect(scrubbed).toMatchObject({
    command: '[redacted:GITHUB_TOKEN]',
    error: {
      message: 'Command not found: [redacted:GITHUB_TOKEN]',
      hint: 'Run `help` for [redacted:GITHUB_TOKEN]',
    },
  });
});

test('#scrubParsedInvocation still scrubs a later secret after a declared one that is too short', () => {
  const ctx = setupTest();

  const scrubbed = scrubParsedInvocation(ctx.failed, ctx.wringer, {
    SHOP_API_TOKEN: 'abcdefg',
    GITHUB_TOKEN: 'planted-github-token',
  });

  expect(scrubbed).toMatchObject({
    error: { message: 'Command not found: [redacted:GITHUB_TOKEN]' },
  });
});

test('#scrubParsedInvocation still scrubs a declared secret that follows a short one', () => {
  const ctx = setupTest();

  const scrubbed = scrubParsedInvocation(ctx.failed, ctx.wringer, {
    SHOP_API_TOKEN: 'abcdefg',
    SHOP_DB_TOKEN: 'planted-github-token',
  });

  expect(scrubbed).toMatchObject({
    error: { message: 'Command not found: [redacted:SHOP_DB_TOKEN]' },
  });
});
