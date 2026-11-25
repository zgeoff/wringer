import { expect, test } from 'bun:test';
import { appendFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { DeclaredSecretSource } from '../secrets/declared-secret-source.ts';
import { createShopWringer } from '../test-utils/create-shop-wringer.ts';
import { createTestSession } from '../test-utils/create-test-session.ts';
import { WringerError } from '../wringer-error.ts';

interface SetupOptions {
  readonly env?: Readonly<Record<string, string>>;
  readonly declaredSecrets?: DeclaredSecretSource;
}

async function setupTest(options: SetupOptions) {
  const wringer = createShopWringer();

  const shop = await createTestSession({
    wringer,
    ...options,
  });

  const stateDir = join(shop.repo.root, wringer.stateDir);

  return {
    root: shop.repo.root,
    state: shop.state,
    lines: shop.lines,
    run: (path: readonly string[], args: unknown = {}) =>
      shop.dispatch(wringer, path, args, { ...shop.session, target: 'local' }),
    runWithEnv: (env: Readonly<Record<string, string>>, path: readonly string[]) =>
      shop.dispatch(wringer, path, {}, { ...shop.session, env, target: 'local' }),
    readSecretsFile: (runID: string) =>
      readFile(join(stateDir, 'runs', runID, 'secrets.ndjson'), 'utf8'),
    removeSecretsFile: (runID: string) => rm(join(stateDir, 'runs', runID, 'secrets.ndjson')),
    appendSecretsFile: (runID: string, text: string) =>
      appendFile(join(stateDir, 'runs', runID, 'secrets.ndjson'), text),

    // Every file under the state folder, joined.
    readStateFiles: async (): Promise<string> => {
      const names = await readdir(stateDir, { recursive: true, withFileTypes: true });

      const texts = await Promise.all(
        names
          .filter((entry) => entry.isFile())
          .map((entry) => readFile(join(entry.parentPath, entry.name), 'utf8')),
      );

      return texts.join('\n');
    },
  };
}

test('#up reads a declared secret from a record, and keeps it as a declared secret', async () => {
  const ctx = await setupTest({ declaredSecrets: { SHOP_API_TOKEN: 'planted-record-token' } });
  const up = await ctx.run(['up']);
  const kept = await ctx.readSecretsFile(up.envelope.instance ?? '');

  expect({ error: up.envelope.error, kept }).toStrictEqual({
    error: null,
    kept: '{"name":"SHOP_API_TOKEN","value":"planted-record-token","origin":"declared"}\n',
  });
});

test('#up reads a declared secret from an async function that gets the deadline', async () => {
  const ctx = await setupTest({
    declaredSecrets: async (signal) => {
      await Promise.resolve();

      return { SHOP_API_TOKEN: signal.aborted ? 'aborted-token-value' : 'planted-async-token' };
    },
  });

  const up = await ctx.run(['up']);
  const kept = await ctx.readSecretsFile(up.envelope.instance ?? '');

  expect(kept).toBe(
    '{"name":"SHOP_API_TOKEN","value":"planted-async-token","origin":"declared"}\n',
  );
});

test('#up calls the source once, and a later command does not call it again', async () => {
  const calls: number[] = [];

  const ctx = await setupTest({
    declaredSecrets: () => {
      calls.push(1);

      return { SHOP_API_TOKEN: 'planted-once-token' };
    },
  });

  await ctx.run(['up']);
  await ctx.run(['doctor']);
  await ctx.run(['up']);

  expect(calls).toHaveLength(1);
});

test('#up fails with environment and names only the class of an error the source throws', async () => {
  class VaultError extends Error {
    override name = 'VaultError';
  }

  const ctx = await setupTest({
    declaredSecrets: () => {
      throw new VaultError('vault said planted-thrown-token');
    },
  });

  const up = await ctx.run(['up']);
  const files = await ctx.readStateFiles();

  expect({
    code: up.envelope.error?.code,
    message: up.envelope.error?.message,
    run: up.envelope.instance,
    envelopeLeak: JSON.stringify(up.envelope).includes('planted-thrown-token'),
    stateLeak: files.includes('planted-thrown-token'),
    lineLeak: ctx.lines.join('\n').includes('planted-thrown-token'),
  }).toStrictEqual({
    code: 'environment',
    message: expect.stringContaining('VaultError'),
    run: null,
    envelopeLeak: false,
    stateLeak: false,
    lineLeak: false,
  });
});

test('#up fails with environment, with no text of the source, for a WringerError it throws', async () => {
  const ctx = await setupTest({
    declaredSecrets: () => {
      throw new WringerError('timeout', { message: 'planted-timeout-token' });
    },
  });

  const up = await ctx.run(['up']);
  const files = await ctx.readStateFiles();

  expect({
    code: up.envelope.error?.code,
    run: up.envelope.instance,
    envelopeLeak: JSON.stringify(up.envelope).includes('planted-timeout-token'),
    stateLeak: files.includes('planted-timeout-token'),
    lineLeak: ctx.lines.join('\n').includes('planted-timeout-token'),
  }).toStrictEqual({
    code: 'environment',
    run: null,
    envelopeLeak: false,
    stateLeak: false,
    lineLeak: false,
  });
});

test('#up fails with environment, with no text of the getter, for a result whose getter throws', async () => {
  const result = {
    get SHOP_API_TOKEN(): string {
      throw new Error('getter said planted-getter-token');
    },
  };

  const ctx = await setupTest({ declaredSecrets: () => result });
  const up = await ctx.run(['up']);
  const files = await ctx.readStateFiles();

  expect({
    code: up.envelope.error?.code,
    run: up.envelope.instance,
    envelopeLeak: JSON.stringify(up.envelope).includes('planted-getter-token'),
    stateLeak: files.includes('planted-getter-token'),
    lineLeak: ctx.lines.join('\n').includes('planted-getter-token'),
  }).toStrictEqual({
    code: 'environment',
    run: null,
    envelopeLeak: false,
    stateLeak: false,
    lineLeak: false,
  });
});

test('#up fails with usage for a feature name that holds a declared value', async () => {
  const ctx = await setupTest({ declaredSecrets: { SHOP_API_TOKEN: 'checkout' } });
  const up = await ctx.run(['up']);
  const files = await ctx.readStateFiles();

  expect({
    code: up.envelope.error?.code,
    run: up.envelope.instance,
    files: files.includes('checkout'),
  }).toStrictEqual({ code: 'usage', run: null, files: false });
});

test('#up fails with environment for a source result that is not a record of strings', async () => {
  const wrong: unknown = { SHOP_API_TOKEN: 12 };

  const ctx = await setupTest({
    // @ts-expect-error The test hands over the wrong shape on purpose.
    declaredSecrets: () => wrong,
  });

  const up = await ctx.run(['up']);

  expect({
    code: up.envelope.error?.code,
    message: up.envelope.error?.message,
    run: up.envelope.instance,
  }).toStrictEqual({
    code: 'environment',
    message: expect.stringContaining('record of secret names to string values'),
    run: null,
  });
});

test('#up skips a declared name that the source leaves out or leaves empty', async () => {
  const ctx = await setupTest({ declaredSecrets: { SHOP_API_TOKEN: '' } });
  const up = await ctx.run(['up']);
  const kept = await ctx.readSecretsFile(up.envelope.instance ?? '');

  expect({ error: up.envelope.error, kept }).toStrictEqual({ error: null, kept: '' });
});

test('#up skips a declared name that the source has no key for', async () => {
  const ctx = await setupTest({ declaredSecrets: {} });
  const up = await ctx.run(['up']);

  expect(up.envelope.error).toBeNull();
});

test('#up fails with usage for a declared value under the minimum length', async () => {
  const ctx = await setupTest({ declaredSecrets: { SHOP_API_TOKEN: 'short' } });
  const up = await ctx.run(['up']);

  expect({ code: up.envelope.error?.code, run: up.envelope.instance }).toStrictEqual({
    code: 'usage',
    run: null,
  });
});

test('it redacts a declared value in a later command output and evidence file', async () => {
  const ctx = await setupTest({ declaredSecrets: { SHOP_API_TOKEN: 'planted-redacted-token' } });

  await ctx.run(['up']);
  await ctx.run(['doctor']);

  const echoed = await ctx.run(['action', 'echo'], { text: 'the token is planted-redacted-token' });
  const evidence = await readFile(join(ctx.root, echoed.envelope.evidence[0]?.path ?? ''), 'utf8');

  expect({ data: echoed.envelope.data, evidence }).toStrictEqual({
    data: { text: 'the token is [redacted:SHOP_API_TOKEN]' },
    evidence: 'the token is [redacted:SHOP_API_TOKEN]',
  });
});

test('it keeps a command with a run from taking a declared name from the process env', async () => {
  const ctx = await setupTest({ declaredSecrets: { SHOP_API_TOKEN: 'planted-source-token' } });

  await ctx.run(['up']);

  const doctor = await ctx.runWithEnv({ SHOP_API_TOKEN: 'short' }, ['doctor']);

  expect(doctor.envelope.error).toBeNull();
});

test('it has a command with no run take a declared name from the process env', async () => {
  const ctx = await setupTest({ declaredSecrets: { SHOP_API_TOKEN: 'planted-source-token' } });
  const result = await ctx.runWithEnv({ SHOP_API_TOKEN: 'short' }, ['echo-runless']);

  expect(result.envelope.error?.code).toBe('usage');
});

test('it reads a secrets file record with no origin as a collected secret', async () => {
  const ctx = await setupTest({ declaredSecrets: { SHOP_API_TOKEN: 'planted-origin-token' } });
  const up = await ctx.run(['up']);

  await ctx.appendSecretsFile(
    up.envelope.instance ?? '',
    '{"name":"notes.session","value":"planted-old-value"}\n',
  );

  await ctx.run(['doctor']);

  const echoed = await ctx.run(['action', 'echo'], { text: 'planted-old-value' });

  expect(echoed.envelope.data).toStrictEqual({ text: '[redacted:notes.session]' });
});

test('it fails a later command with environment once the secrets file of its run is gone', async () => {
  const ctx = await setupTest({ declaredSecrets: { SHOP_API_TOKEN: 'planted-lost-token' } });
  const up = await ctx.run(['up']);

  await ctx.removeSecretsFile(up.envelope.instance ?? '');

  const doctor = await ctx.run(['doctor']);

  expect(doctor.envelope.error?.code).toBe('environment');
});

test('it lets down stop a run whose secrets file is gone', async () => {
  const ctx = await setupTest({ declaredSecrets: { SHOP_API_TOKEN: 'planted-lost-token' } });
  const up = await ctx.run(['up']);

  await ctx.removeSecretsFile(up.envelope.instance ?? '');

  const down = await ctx.run(['down']);

  expect(down.envelope.error).toBeNull();
});

test('#up keeps a secrets file for a source that gives no value, so a later command still runs', async () => {
  const ctx = await setupTest({ declaredSecrets: {} });
  const up = await ctx.run(['up']);
  const kept = await ctx.readSecretsFile(up.envelope.instance ?? '');
  const doctor = await ctx.run(['doctor']);

  expect({ kept, error: doctor.envelope.error }).toStrictEqual({ kept: '', error: null });
});
