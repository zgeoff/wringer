import { expect, jest, onTestFinished, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { createWringer } from '../create-wringer.ts';
import { dispatch } from '../dispatch.ts';
import { local } from '../local.ts';
import { readVerdicts } from '../read-verdicts.ts';
import { createTestSession } from '../test-utils/create-test-session.ts';
import type { TargetDefinition } from '../types.ts';

async function setupTest() {
  const emptySchema = z.strictObject({});

  // What the staging app reports as its revision; a test replaces it.
  const app: { revision: () => unknown } = { revision: () => 'unset' };

  const staging: TargetDefinition = {
    mode: 'attach',
    access: 'read-only',
    host: local(),
    revision: () => 'unset',
  };

  // A JavaScript caller can give a `revision` that returns a non-string, which the type forbids.
  Reflect.set(staging, 'revision', () => app.revision());

  const wringer = createWringer({ name: 'shop' })
    .secret('SAMPLE_API_TOKEN')
    .target('staging', staging)
    .target('plain', { mode: 'attach', access: 'read-only', host: local() })
    .action({
      name: 'ping',
      summary: 'Touch the app',
      effect: 'read',
      input: emptySchema,
      data: emptySchema,
      run: () => Promise.resolve({}),
    })
    .feature({ name: 'checkout', summary: 'Pay for the cart', paths: ['src/checkout/**'] })
    .feature({ name: 'search', summary: 'Find a product', paths: ['src/search/**'] })
    .shared('package.json')
    .ignore('**/*.md')
    .build();

  const shop = await createTestSession({ parent: import.meta.dir, wringer });

  const write = async (path: string, text: string) => {
    await mkdir(join(shop.repo.root, path, '..'), { recursive: true });
    await writeFile(join(shop.repo.root, path), text);
  };

  // The declared secret is hex, so a test can make a revision hold it.
  const env = { SAMPLE_API_TOKEN: 'beefcafe0042' };

  const run = (path: readonly string[], args: unknown = {}, timeoutMs?: number) =>
    dispatch(wringer, path, args, { ...shop.session, env, target: 'staging', timeoutMs });

  const commit = async (message: string) => {
    await shop.repo.git('add', '.');
    await shop.repo.git('commit', '--quiet', '-m', message);

    const head = await shop.repo.git('rev-parse', 'HEAD');

    return head.trim();
  };

  // Commit A holds both features' files and is what staging runs. Commit B and an uncommitted edit
  // then change only the search files.
  const deployWithSearchEdits = async () => {
    await write('src/checkout/pay.ts', 'export const pay = 1;\n');
    await write('src/search/find.ts', 'export const find = 1;\n');

    const deployed = await commit('add the app');

    await write('src/search/find.ts', 'export const find = 2;\n');
    await commit('change search');
    await write('src/search/find.ts', 'export const find = 3;\n');

    app.revision = () => deployed;

    return deployed;
  };

  return {
    app,
    deployWithSearchEdits,
    write,
    commit,
    git: shop.repo.git,
    run,
    runPlain: (path: readonly string[], args: unknown = {}) =>
      dispatch(wringer, path, args, { ...shop.session, env, target: 'plain' }),
    readVerdicts: () => readVerdicts(shop.state, shop.session.repoHost, shop.repo.root),
    readEvents: async () => {
      const [runID] = await shop.state.listRuns();

      return shop.state.readRunEvents(String(runID));
    },

    // A doctor that passed with no revision read: the run view clears the value a doctor-passed
    // event follows.
    seedDoctorWithoutRevision: async () => {
      const [runID] = await shop.state.listRuns();

      await shop.state.appendEvent(String(runID), {
        type: 'doctor-passed',
        at: new Date().toISOString(),
        results: [],
      });
    },

    // Attaches, passes the doctor, and drives checkout once.
    driveCheckout: async () => {
      await run(['attach']);
      await run(['doctor']);
      await run(['use'], { feature: 'checkout' });
      await run(['action', 'ping']);
    },
  };
}

test('#done pins a verdict to the deployed commit that differs from HEAD only outside the feature', async () => {
  const ctx = await setupTest();
  const deployed = await ctx.deployWithSearchEdits();

  await ctx.driveCheckout();

  const result = await ctx.run(['done']);

  expect(result.envelope.data).toStrictEqual({
    feature: 'checkout',
    fingerprint: expect.any(String),
    featureFingerprint: expect.any(String),
    run: expect.any(String),
    at: expect.any(String),
    target: { name: 'staging', evidence: 'local' },
    pin: { kind: 'deployed', revision: deployed },
    evidence: [],
  });
});

test('#done pins to the full commit id when the target reports a prefix in capitals', async () => {
  const ctx = await setupTest();
  const deployed = await ctx.deployWithSearchEdits();

  ctx.app.revision = () => ` ${deployed.slice(0, 9).toUpperCase()}\n`;

  await ctx.driveCheckout();

  const result = await ctx.run(['done']);

  expect(result.envelope.data).toStrictEqual({
    feature: 'checkout',
    fingerprint: expect.any(String),
    featureFingerprint: expect.any(String),
    run: expect.any(String),
    at: expect.any(String),
    target: { name: 'staging', evidence: 'local' },
    pin: { kind: 'deployed', revision: deployed },
    evidence: [],
  });
});

test('#done records the pin of a deployed verdict in the worktree', async () => {
  const ctx = await setupTest();
  const deployed = await ctx.deployWithSearchEdits();

  await ctx.driveCheckout();
  await ctx.run(['done']);

  const recorded = await ctx.readVerdicts();

  const verdicts = [...recorded.values()];

  expect(verdicts.map((verdict) => verdict.pin)).toStrictEqual([
    { kind: 'deployed', revision: deployed },
  ]);
});

test('#done refuses and names the paths when the deployed commit differs inside the scope', async () => {
  const ctx = await setupTest();

  await ctx.deployWithSearchEdits();
  await ctx.write('src/checkout/pay.ts', 'export const pay = 2;\n');
  await ctx.write('src/checkout/refund.ts', 'export const refund = 1;\n');
  await ctx.driveCheckout();

  const result = await ctx.run(['done']);

  expect({
    exitCode: result.exitCode,
    code: result.envelope.error?.code,
    message: result.envelope.error?.message,
  }).toStrictEqual({
    exitCode: 1,
    code: 'check-failed',
    message: expect.stringContaining('src/checkout/pay.ts, src/checkout/refund.ts'),
  });
});

test('#done names at most 10 differing paths', async () => {
  const ctx = await setupTest();

  await ctx.deployWithSearchEdits();

  for (let index = 0; index < 12; index += 1) {
    await ctx.write(`src/checkout/file-${String(index).padStart(2, '0')}.ts`, 'export {};\n');
  }

  await ctx.driveCheckout();

  const result = await ctx.run(['done']);

  expect(result.envelope.error?.message).toContain('file-09.ts, and 2 more');
});

test('#done refuses a deployed commit that differs in a shared path', async () => {
  const ctx = await setupTest();

  await ctx.write('src/checkout/pay.ts', 'export const pay = 1;\n');
  await ctx.write('package.json', '{"name":"shop"}\n');

  const deployed = await ctx.commit('add the app');

  ctx.app.revision = () => deployed;

  await ctx.write('package.json', '{"name":"shop","private":true}\n');
  await ctx.driveCheckout();

  const result = await ctx.run(['done']);

  expect({
    code: result.envelope.error?.code,
    message: result.envelope.error?.message,
  }).toStrictEqual({
    code: 'check-failed',
    message: expect.stringContaining('scope of checkout: package.json.'),
  });
});

test('#done refuses a revision that is not a string', async () => {
  const ctx = await setupTest();

  await ctx.deployWithSearchEdits();
  await ctx.driveCheckout();

  ctx.app.revision = () => Reflect.get({}, 'sha');

  const result = await ctx.run(['done']);

  expect({
    code: result.envelope.error?.code,
    message: result.envelope.error?.message,
  }).toStrictEqual({
    code: 'check-failed',
    message: expect.stringContaining('not 7 to 64 hex characters: undefined'),
  });
});

test('#done pins when the only difference is a path the registry ignores', async () => {
  const ctx = await setupTest();

  await ctx.write('src/checkout/pay.ts', 'export const pay = 1;\n');

  const deployed = await ctx.commit('add the app');

  ctx.app.revision = () => deployed;

  await ctx.write('src/checkout/notes.md', 'unsent\n');
  await ctx.write('README.md', '# changed\n');
  await ctx.write('src/checkout/pay.ts', 'export const pay = 1;\n');
  await ctx.driveCheckout();

  const result = await ctx.run(['done']);

  expect(result.envelope.data).toStrictEqual({
    feature: 'checkout',
    fingerprint: expect.any(String),
    featureFingerprint: expect.any(String),
    run: expect.any(String),
    at: expect.any(String),
    target: { name: 'staging', evidence: 'local' },
    pin: { kind: 'deployed', revision: deployed },
    evidence: [],
  });
});

test('#done refuses a deployed commit the clone lacks, with a fetch hint', async () => {
  const ctx = await setupTest();

  await ctx.deployWithSearchEdits();

  ctx.app.revision = () => '1234567';

  await ctx.driveCheckout();

  const result = await ctx.run(['done']);

  expect(result.envelope.error?.hint).toBe(
    'Run `git fetch origin 1234567`, then run `done` again.',
  );
});

test('#done refuses a revision that names a tag object', async () => {
  const ctx = await setupTest();

  await ctx.deployWithSearchEdits();
  await ctx.git('tag', '--annotate', '--message', 'release', 'v1', 'HEAD~1');

  const tagOutput = await ctx.git('rev-parse', 'v1');

  const tagObject = tagOutput.trim();

  ctx.app.revision = () => tagObject;

  await ctx.driveCheckout();

  const result = await ctx.run(['done']);

  expect(result.envelope.error?.hint).toBe(
    `Run \`git fetch origin ${tagObject}\`, then run \`done\` again.`,
  );
});

test('#done refuses a revision that changed since the doctor', async () => {
  const ctx = await setupTest();
  const deployed = await ctx.deployWithSearchEdits();

  await ctx.driveCheckout();

  ctx.app.revision = () => `${deployed.slice(0, 39)}${deployed.endsWith('0') ? '1' : '0'}`;

  const result = await ctx.run(['done']);

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 3,
    code: 'doctor-required',
  });
});

test('#done refuses a revision that moved to another commit of the clone since the doctor', async () => {
  const ctx = await setupTest();

  await ctx.deployWithSearchEdits();
  await ctx.driveCheckout();

  const headOutput = await ctx.git('rev-parse', 'HEAD');

  const head = headOutput.trim();

  ctx.app.revision = () => head;

  const result = await ctx.run(['done']);

  expect({ exitCode: result.exitCode, code: result.envelope.error?.code }).toStrictEqual({
    exitCode: 3,
    code: 'doctor-required',
  });
});

test('#done refuses a revision that names a tree', async () => {
  const ctx = await setupTest();

  await ctx.deployWithSearchEdits();

  const treeOutput = await ctx.git('rev-parse', 'HEAD~1^{tree}');

  const tree = treeOutput.trim();

  ctx.app.revision = () => tree;

  await ctx.driveCheckout();

  const result = await ctx.run(['done']);

  expect({ code: result.envelope.error?.code, hint: result.envelope.error?.hint }).toStrictEqual({
    code: 'check-failed',
    hint: `Run \`git fetch origin ${tree}\`, then run \`done\` again.`,
  });
});

test('#done accepts a revision the doctor read as a prefix and the app now gives in full', async () => {
  const ctx = await setupTest();
  const deployed = await ctx.deployWithSearchEdits();

  ctx.app.revision = () => deployed.slice(0, 10);

  await ctx.driveCheckout();

  ctx.app.revision = () => deployed;

  const result = await ctx.run(['done']);

  expect(result.envelope.data).toStrictEqual({
    feature: 'checkout',
    fingerprint: expect.any(String),
    featureFingerprint: expect.any(String),
    run: expect.any(String),
    at: expect.any(String),
    target: { name: 'staging', evidence: 'local' },
    pin: { kind: 'deployed', revision: deployed },
    evidence: [],
  });
});

test('#done refuses a run whose doctor wrote no revision', async () => {
  const ctx = await setupTest();

  await ctx.deployWithSearchEdits();
  await ctx.run(['attach']);
  await ctx.run(['doctor']);
  await ctx.seedDoctorWithoutRevision();
  await ctx.run(['use'], { feature: 'checkout' });
  await ctx.run(['action', 'ping']);

  const result = await ctx.run(['done']);

  expect({ code: result.envelope.error?.code, hint: result.envelope.error?.hint }).toStrictEqual({
    code: 'doctor-required',
    hint: 'Run `doctor`, then drive the feature again.',
  });
});

test('#done refuses, with a check-the-target hint, when revision throws', async () => {
  const ctx = await setupTest();

  await ctx.deployWithSearchEdits();
  await ctx.driveCheckout();

  ctx.app.revision = () => {
    throw new Error('connection refused');
  };

  const result = await ctx.run(['done']);

  expect({ code: result.envelope.error?.code, hint: result.envelope.error?.hint }).toStrictEqual({
    code: 'environment',
    hint: 'Check the target, then run `done` again.',
  });
});

test('#done refuses an unknown feature without calling revision', async () => {
  const ctx = await setupTest();

  await ctx.deployWithSearchEdits();
  await ctx.driveCheckout();

  const calls: string[] = [];

  ctx.app.revision = () => {
    calls.push('revision');
    throw new Error('connection refused');
  };

  const result = await ctx.run(['done'], { feature: 'wishlist' });

  expect({ code: result.envelope.error?.code, calls }).toStrictEqual({
    code: 'usage',
    calls: [],
  });
});

test('#done refuses a feature with no drives without calling revision', async () => {
  const ctx = await setupTest();

  await ctx.deployWithSearchEdits();
  await ctx.driveCheckout();

  const calls: string[] = [];

  ctx.app.revision = () => {
    calls.push('revision');
    throw new Error('connection refused');
  };

  const result = await ctx.run(['done'], { feature: 'search' });

  expect({ code: result.envelope.error?.code, calls }).toStrictEqual({
    code: 'check-failed',
    calls: [],
  });
});

test('#done refuses when revision takes longer than 5 s', async () => {
  const ctx = await setupTest();

  await ctx.deployWithSearchEdits();
  await ctx.driveCheckout();

  const called = Promise.withResolvers<undefined>();

  ctx.app.revision = () => {
    called.resolve(undefined);

    return Promise.withResolvers<string>().promise;
  };

  jest.useFakeTimers();

  onTestFinished(() => {
    jest.useRealTimers();
  });

  const done = ctx.run(['done']);

  await called.promise;

  jest.advanceTimersByTime(5001);

  const result = await done;

  expect({ code: result.envelope.error?.code, hint: result.envelope.error?.hint }).toStrictEqual({
    code: 'timeout',
    hint: 'Check the target, then run `done` again.',
  });
});

test('#done records an unpinned verdict on an attach target with no revision', async () => {
  const ctx = await setupTest();

  await ctx.write('src/checkout/pay.ts', 'export const pay = 1;\n');
  await ctx.runPlain(['attach']);
  await ctx.runPlain(['doctor']);
  await ctx.runPlain(['use'], { feature: 'checkout' });
  await ctx.runPlain(['action', 'ping']);

  const result = await ctx.runPlain(['done']);

  expect(result.envelope.data).toStrictEqual({
    feature: 'checkout',
    fingerprint: expect.any(String),
    featureFingerprint: expect.any(String),
    run: expect.any(String),
    at: expect.any(String),
    target: { name: 'plain', evidence: 'local' },
    pin: { kind: 'unpinned' },
    evidence: [],
  });
});

test('#doctor writes revision-read, normalized, just before doctor-passed', async () => {
  const ctx = await setupTest();

  ctx.app.revision = () => ' 5E1D0A7\n';

  await ctx.run(['attach']);
  await ctx.run(['doctor']);

  const events = await ctx.readEvents();

  const types = events.map((event) => event.type).filter((type) => type !== 'envelope');

  expect(types.slice(-2)).toStrictEqual(['revision-read', 'doctor-passed']);

  expect(events.find((event) => event.type === 'revision-read')).toStrictEqual({
    type: 'revision-read',
    at: expect.any(String),
    revision: '5e1d0a7',
  });
});

test('#doctor fails the revision check when revision returns a branch name', async () => {
  const ctx = await setupTest();

  ctx.app.revision = () => 'main';

  await ctx.run(['attach']);

  const result = await ctx.run(['doctor']);
  const events = await ctx.readEvents();

  expect({
    code: result.envelope.error?.code,
    failed: result.envelope.error?.message,
    types: events.map((event) => event.type).filter((type) => type.startsWith('doctor')),
    wrote: events.some((event) => event.type === 'revision-read'),
  }).toStrictEqual({
    code: 'check-failed',
    failed: 'The doctor failed: revision.',
    types: ['doctor-failed'],
    wrote: false,
  });
});

test('#doctor fails the revision check when revision returns a non-string', async () => {
  const ctx = await setupTest();

  ctx.app.revision = () => Reflect.get({}, 'sha');

  await ctx.run(['attach']);

  const result = await ctx.run(['doctor']);

  expect(result.envelope.data).toStrictEqual({
    passed: false,
    results: [
      {
        name: 'revision',
        status: 'failed',
        durationMs: expect.any(Number),
        code: 'check-failed',
        message: expect.stringContaining('not 7 to 64 hex characters: undefined'),
      },
    ],
  });
});

test('#doctor fails the revision check, naming only the secret, when the revision holds one', async () => {
  const ctx = await setupTest();

  ctx.app.revision = () => '0123beefcafe00429876';

  await ctx.run(['attach']);

  const result = await ctx.run(['doctor']);
  const events = await ctx.readEvents();

  expect({
    results: result.envelope.data,
    wrote: events.some((event) => event.type === 'revision-read'),
    leaked: JSON.stringify(events).includes('beefcafe0042'),
  }).toStrictEqual({
    results: {
      passed: false,
      results: [
        {
          name: 'revision',
          status: 'failed',
          durationMs: expect.any(Number),
          code: 'usage',
          message: expect.stringContaining(
            "The target's revision holds the secret SAMPLE_API_TOKEN",
          ),
        },
      ],
    },
    wrote: false,
    leaked: false,
  });
});

test('#doctor leaves no part of a secret in the run log when a non-hex revision holds one', async () => {
  const ctx = await setupTest();

  ctx.app.revision = () => `${'x'.repeat(74)}beefcafe0042`;

  await ctx.run(['attach']);

  const result = await ctx.run(['doctor']);
  const events = await ctx.readEvents();

  expect({
    code: result.envelope.error?.code,
    leaked: /beef/u.test(JSON.stringify({ events, envelope: result.envelope })),
  }).toStrictEqual({ code: 'check-failed', leaked: false });
});

test('#doctor fails the revision check when revision takes longer than 5 s', async () => {
  const ctx = await setupTest();

  await ctx.run(['attach']);

  const called = Promise.withResolvers<undefined>();

  ctx.app.revision = () => {
    called.resolve(undefined);

    return Promise.withResolvers<string>().promise;
  };

  jest.useFakeTimers();

  onTestFinished(() => {
    jest.useRealTimers();
  });

  const doctor = ctx.run(['doctor']);

  await called.promise;

  jest.advanceTimersByTime(5001);

  const result = await doctor;

  expect(result.envelope.data).toStrictEqual({
    passed: false,
    results: [
      {
        name: 'revision',
        status: 'failed',
        durationMs: expect.any(Number),
        code: 'timeout',
        message: 'revision ran past 5000 ms.',
      },
    ],
  });
});

test('#doctor fails the revision check when revision throws', async () => {
  const ctx = await setupTest();

  ctx.app.revision = () => {
    throw new Error('connection refused');
  };

  await ctx.run(['attach']);

  const result = await ctx.run(['doctor']);

  expect(result.envelope.data).toStrictEqual({
    passed: false,
    results: [
      {
        name: 'revision',
        status: 'failed',
        durationMs: expect.any(Number),
        code: 'environment',
        message: expect.stringContaining('connection refused'),
      },
    ],
  });
});

test('#doctor runs no revision check on a target that has none', async () => {
  const ctx = await setupTest();

  await ctx.runPlain(['attach']);

  const result = await ctx.runPlain(['doctor']);
  const events = await ctx.readEvents();

  expect({
    data: result.envelope.data,
    wrote: events.some((event) => event.type === 'revision-read'),
  }).toStrictEqual({ data: { passed: true, results: [] }, wrote: false });
});
