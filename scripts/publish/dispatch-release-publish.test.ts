import { expect, test } from 'bun:test';
import { createStubBin } from '@zgeoff/testing/bin';
import { createTempDir } from '@zgeoff/testing/fs';
import { runCommand } from '../ci/run-command.ts';
import { dispatchReleasePublish } from './dispatch-release-publish.ts';

function setupTest() {
  const directory = createTempDir('dispatch-release-publish').path;

  // A call to anything but a workflow dispatch fails, which names the call.
  const gh = createStubBin(directory, 'gh', { answers: [{ args: ['workflow', 'run'] }] });
  const errors: string[] = [];

  const runDispatch = (
    releaseOutputs: Readonly<Record<string, string>>,
    runEnv: Readonly<Record<string, string>> = {},
  ) =>
    dispatchReleasePublish({
      cwd: directory,
      env: { PATH: `${directory}:${process.env['PATH']}`, ...runEnv },
      repository: 'zgeoff/tools',
      releaseOutputsText: JSON.stringify(releaseOutputs),
      runCommand,
      writeError: (text) => {
        errors.push(text);
      },
    });

  return { gh, errors, runDispatch };
}

test('it dispatches the publish at the first tag, with every released path', async () => {
  const ctx = setupTest();

  const exitCode = await ctx.runDispatch({
    releases_created: 'true',
    paths_released: '["packages/std","packages/tsconfig"]',
    'packages/std--sha': 'merge222',
    'packages/std--tag_name': '@zgeoff/std@0.4.0',
    'packages/tsconfig--sha': 'merge222',
    'packages/tsconfig--tag_name': '@zgeoff/tsconfig@1.2.0',
  });

  const calls = ctx.gh.readCalls().map((call) => call.argv);

  expect(exitCode).toBe(0);

  expect(calls).toStrictEqual([
    [
      'workflow',
      'run',
      'main.yml',
      '--repo',
      'zgeoff/tools',
      '--ref',
      '@zgeoff/std@0.4.0',
      '-f',
      'republish_paths=["packages/std","packages/tsconfig"]',
    ],
  ]);
});

test('it dispatches a release that tagged the commit of the run itself, like any other', async () => {
  const ctx = setupTest();

  // The run's own commit is the one the release tagged.
  const exitCode = await ctx.runDispatch(
    {
      releases_created: 'true',
      paths_released: '["packages/std"]',
      'packages/std--sha': 'old111',
      'packages/std--tag_name': '@zgeoff/std@0.4.0',
    },
    { GITHUB_SHA: 'old111' },
  );

  const calls = ctx.gh.readCalls().map((call) => call.argv);

  expect(exitCode).toBe(0);

  expect(calls).toStrictEqual([
    [
      'workflow',
      'run',
      'main.yml',
      '--repo',
      'zgeoff/tools',
      '--ref',
      '@zgeoff/std@0.4.0',
      '-f',
      'republish_paths=["packages/std"]',
    ],
  ]);
});

test.each([
  [
    'two release commits',
    {
      paths_released: '["packages/std","packages/tsconfig"]',
      'packages/std--sha': 'merge222',
      'packages/std--tag_name': '@zgeoff/std@0.4.0',
      'packages/tsconfig--sha': 'merge333',
      'packages/tsconfig--tag_name': '@zgeoff/tsconfig@1.2.0',
    },
    '::error::expected one release commit, got: merge222 merge333\n',
  ],
  [
    'a path with no release commit',
    { paths_released: '["packages/std"]', 'packages/std--tag_name': '@zgeoff/std@0.4.0' },
    '::error::expected one release commit, got: null\n',
  ],
  ['no released path', { paths_released: '[]' }, '::error::expected one release commit, got: \n'],
  [
    'no tag for its first path',
    { paths_released: '["packages/std"]', 'packages/std--sha': 'merge222' },
    '::error::the release outputs hold no tag for packages/std\n',
  ],
])('it dispatches nothing and fails for a release with %s', async (_label, outputs, error) => {
  const ctx = setupTest();

  const exitCode = await ctx.runDispatch({ releases_created: 'true', ...outputs });

  const calls = ctx.gh.readCalls().map((call) => call.argv);

  expect(exitCode).toBe(1);
  expect(ctx.errors).toStrictEqual([error]);
  expect(calls).toBeEmpty();
});
