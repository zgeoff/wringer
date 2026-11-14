import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { dispatch } from '@wringer/core';
import { createTestSession } from '@wringer/core/test-utils/create-test-session.ts';
import { updateEnv } from '@zgeoff/testing/helpers';
import { createTerminalWringer } from './test-utils/create-terminal-wringer.ts';

async function setupTest() {
  const wringer = createTerminalWringer();

  const shop = await createTestSession({ parent: import.meta.dir, wringer });

  const run = (target: string, path: readonly string[], args: unknown = {}) =>
    dispatch(wringer, path, args, { ...shop.session, target });

  return {
    run,
    readEvidence: (path: string) => Bun.file(join(shop.repo.root, path)).text(),
    start: async (target: string) => {
      await run(target, ['attach']);
      await run(target, ['doctor']);
    },
  };
}

test('it drives a program to a waited-for screen and keeps the screen as evidence', async () => {
  const ctx = await setupTest();

  await ctx.start('local');
  await ctx.run('local', ['terminal', 'start'], { program: 'echo' });
  await ctx.run('local', ['terminal', 'wait'], { text: 'ready' });
  await ctx.run('local', ['terminal', 'type'], { text: 'Hi there' });
  await ctx.run('local', ['terminal', 'wait'], { regex: 'typed: Hi there' });

  const result = await ctx.run('local', ['terminal', 'screen']);
  const evidence = await ctx.readEvidence(result.envelope.evidence[0]?.path ?? '');

  expect({ exitCode: result.exitCode, evidence }).toStrictEqual({
    exitCode: 0,
    evidence: expect.stringContaining('typed: Hi there'),
  });
});

test('it reports the match position and the screen of a wait', async () => {
  const ctx = await setupTest();

  await ctx.start('local');
  await ctx.run('local', ['terminal', 'start'], { program: 'echo' });

  const result = await ctx.run('local', ['terminal', 'wait'], { text: 'ready' });

  expect(result.envelope.data).toMatchObject({
    session: 'echo-1',
    match: { row: 3, col: 0 },
    screen: { cols: 60, rows: 12 },
  });
});

test('it fails a wait that finds no match with check-failed and the last screen', async () => {
  const ctx = await setupTest();

  await ctx.start('local');
  await ctx.run('local', ['terminal', 'start'], { program: 'echo' });
  await ctx.run('local', ['terminal', 'wait'], { text: 'ready' });

  const result = await ctx.run('local', ['terminal', 'wait'], {
    text: 'never shown',
    timeoutMs: 300,
  });

  const evidence = await ctx.readEvidence(result.envelope.evidence[0]?.path ?? '');

  expect({
    exitCode: result.exitCode,
    code: result.envelope.error?.code,
    evidence,
  }).toStrictEqual({
    exitCode: 1,
    code: 'check-failed',
    evidence: expect.stringContaining('Echo TUI'),
  });
});

test('it sends a plain letter key as that letter', async () => {
  const ctx = await setupTest();

  await ctx.start('local');
  await ctx.run('local', ['terminal', 'start'], { program: 'echo' });
  await ctx.run('local', ['terminal', 'wait'], { text: 'ready' });
  await ctx.run('local', ['terminal', 'press'], { keys: ['r'] });

  const result = await ctx.run('local', ['terminal', 'wait'], { text: 'keys: 72' });

  expect(result.exitCode).toBe(0);
});

test('it sends ctrl+c as the control byte to a plain program', async () => {
  const ctx = await setupTest();

  await ctx.start('local');
  await ctx.run('local', ['terminal', 'start'], { program: 'echo' });
  await ctx.run('local', ['terminal', 'wait'], { text: 'ready' });
  await ctx.run('local', ['terminal', 'press'], { keys: ['ctrl+c'] });

  const result = await ctx.run('local', ['terminal', 'wait'], { regex: 'keys: 03$' });

  expect(result.exitCode).toBe(0);
});

test('it sends ctrl+c as a kitty sequence once the program turns the protocol on', async () => {
  const ctx = await setupTest();

  await ctx.start('local');
  await ctx.run('local', ['terminal', 'start'], { program: 'kitty' });
  await ctx.run('local', ['terminal', 'wait'], { text: 'ready' });
  await ctx.run('local', ['terminal', 'press'], { keys: ['ctrl+c'] });

  // \x1b[99;5u
  const result = await ctx.run('local', ['terminal', 'wait'], { text: 'keys: 1b5b39393b3575' });

  expect(result.exitCode).toBe(0);
});

test('it refuses start, type, press and stop on a read-only target with exit 3', async () => {
  const ctx = await setupTest();

  await ctx.start('prod');

  const results = [
    await ctx.run('prod', ['terminal', 'start'], { program: 'echo' }),
    await ctx.run('prod', ['terminal', 'type'], { text: 'a' }),
    await ctx.run('prod', ['terminal', 'press'], { keys: ['enter'] }),
    await ctx.run('prod', ['terminal', 'stop']),
  ];

  expect(results.map((result) => [result.exitCode, result.envelope.error?.code])).toStrictEqual([
    [3, 'read-only'],
    [3, 'read-only'],
    [3, 'read-only'],
    [3, 'read-only'],
  ]);
});

test('it allows screen on a read-only target', async () => {
  const ctx = await setupTest();

  await ctx.start('prod');

  const result = await ctx.run('prod', ['terminal', 'list']);

  expect({ exitCode: result.exitCode, data: result.envelope.data }).toStrictEqual({
    exitCode: 0,
    data: { sessions: [] },
  });
});

test('it keeps a secret typed with --secret-env out of the envelope and the screen evidence', async () => {
  const ctx = await setupTest();

  updateEnv('SHOP_LOGIN_PIN', 'plum-harbour-91');

  await ctx.start('local');
  await ctx.run('local', ['terminal', 'start'], { program: 'echo' });
  await ctx.run('local', ['terminal', 'wait'], { text: 'ready' });
  await ctx.run('local', ['terminal', 'type'], { secretEnv: 'SHOP_LOGIN_PIN' });
  await ctx.run('local', ['terminal', 'wait'], { regex: 'typed: plum-harbour-91' });

  const screen = await ctx.run('local', ['terminal', 'screen']);
  const evidence = await ctx.readEvidence(screen.envelope.evidence[0]?.path ?? '');

  expect(JSON.stringify(screen.envelope) + evidence).not.toContain('plum-harbour-91');
});

test('it keeps a secret that wrapped across rows out of the envelope and the screen evidence', async () => {
  const ctx = await setupTest();

  updateEnv(
    'SHOP_LOGIN_PIN',
    'orchid-meadow-orchid-meadow-orchid-meadow-orchid-meadow-orchid-meadow-ZZEND',
  );

  await ctx.start('local');
  await ctx.run('local', ['terminal', 'start'], { program: 'echo' });
  await ctx.run('local', ['terminal', 'wait'], { text: 'ready' });
  await ctx.run('local', ['terminal', 'type'], { secretEnv: 'SHOP_LOGIN_PIN' });
  await ctx.run('local', ['terminal', 'wait'], { text: 'ZZEND' });

  const screen = await ctx.run('local', ['terminal', 'screen']);
  const evidence = await ctx.readEvidence(screen.envelope.evidence[0]?.path ?? '');

  expect(JSON.stringify(screen.envelope) + evidence).not.toMatch(/orchid|meadow|ZZEND/u);
});

test('it needs --session when more than one session runs', async () => {
  const ctx = await setupTest();

  await ctx.start('local');
  await ctx.run('local', ['terminal', 'start'], { program: 'echo' });
  await ctx.run('local', ['terminal', 'start'], { program: 'echo' });

  const refused = await ctx.run('local', ['terminal', 'screen']);
  const chosen = await ctx.run('local', ['terminal', 'screen'], { session: 'echo-2' });

  expect([refused.envelope.error?.code, chosen.exitCode]).toStrictEqual(['usage', 0]);
});

test('it stops a session and reports its exit code', async () => {
  const ctx = await setupTest();

  await ctx.start('local');
  await ctx.run('local', ['terminal', 'start'], { program: 'echo' });

  const result = await ctx.run('local', ['terminal', 'stop']);

  expect(result.envelope.data).toStrictEqual({ session: 'echo-1', exitCode: 143 });
});

test('it refuses a program the target does not name', async () => {
  const ctx = await setupTest();

  await ctx.start('local');

  const result = await ctx.run('local', ['terminal', 'start'], { program: 'rm' });

  expect([result.exitCode, result.envelope.error?.code]).toStrictEqual([2, 'usage']);
});

test('it lists a program that has exited with its exit code', async () => {
  const ctx = await setupTest();

  await ctx.start('local');
  await ctx.run('local', ['terminal', 'start'], { program: 'quick' });
  await ctx.run('local', ['terminal', 'wait'], { text: 'done' });

  const result = await ctx.run('local', ['terminal', 'list']);

  expect(result.envelope.data).toStrictEqual({
    sessions: [
      {
        session: 'quick-1',
        program: 'quick',
        pid: expect.any(Number),
        running: false,
        exitCode: 0,
      },
    ],
  });
});
