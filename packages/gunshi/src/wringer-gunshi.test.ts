import { expect, onTestFinished, test } from 'bun:test';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { envelopeSchema, runProcess } from '@wringer/core';
import { createTestFolder } from '@wringer/core/test-utils/create-test-folder.ts';
import { createTestRepo } from '@wringer/core/test-utils/create-test-repo.ts';
import { guideFolder, readGuide } from './read-guide.ts';

// The bin runs in a git repo that has no verify CLI, as it does when an agent adds the first one.
async function setupTest() {
  const repo = await createTestRepo(import.meta.dir);

  onTestFinished(() => rm(repo.root, { recursive: true, force: true }));

  return {
    runBin: (args: string[]) =>
      runProcess({
        argv: ['bun', join(import.meta.dir, 'wringer-gunshi.ts'), ...args],
        cwd: repo.root,
      }),
  };
}

test('it lists the topics of the shipped guide with its version', async () => {
  const ctx = await setupTest();
  const guide = await readGuide();
  const result = await ctx.runBin(['guide', '--json']);

  expect({
    exitCode: result.exitCode,
    data: envelopeSchema.parse(JSON.parse(result.stdout)).data,
  }).toStrictEqual({
    exitCode: 0,
    data: {
      version: guide.version,
      topics: guide.topics.map((topic) => ({ name: topic.name, summary: topic.summary })),
    },
  });
});

test('it prints the create topic with the installed version', async () => {
  const ctx = await setupTest();
  const guide = await readGuide();
  const result = await ctx.runBin(['guide', 'create', '--json']);

  const create = guide.topics.find((topic) => topic.name === 'create');

  expect({
    exitCode: result.exitCode,
    data: envelopeSchema.parse(JSON.parse(result.stdout)).data,
  }).toStrictEqual({
    exitCode: 0,
    data: { version: guide.version, topic: 'create', text: create?.text },
  });
});

test('it prints only the text of a topic for a person', async () => {
  const ctx = await setupTest();
  const guide = await readGuide();
  const result = await ctx.runBin(['guide', 'create', '--human']);

  expect(result).toMatchObject({
    exitCode: 0,
    stdout: guide.topics.find((topic) => topic.name === 'create')?.text,
  });
});

test('it names the installed template folder in the template topic', async () => {
  const ctx = await setupTest();
  const result = await ctx.runBin(['guide', 'template', '--human']);

  expect(result.stdout).toContain(join(guideFolder, 'template'));
});

test('it fails an unknown topic with usage and lists the topics', async () => {
  const ctx = await setupTest();
  const result = await ctx.runBin(['guide', 'nope', '--json']);

  const envelope = envelopeSchema.parse(JSON.parse(result.stdout));

  expect({ exitCode: result.exitCode, error: envelope.error }).toStrictEqual({
    exitCode: 2,
    error: expect.objectContaining({
      code: 'usage',
      hint: expect.stringContaining('create'),
    }),
  });
});

test('it has no skill install command', async () => {
  const ctx = await setupTest();
  const result = await ctx.runBin(['skill', 'install', '--json']);

  expect(result.exitCode).not.toBe(0);
});

test('it prints the guide from a folder that is no git worktree and leaves it empty', async () => {
  const folder = await createTestFolder(import.meta.dir, 'guide-outside-repo');

  onTestFinished(() => rm(folder, { recursive: true, force: true }));

  const result = await runProcess({
    argv: ['bun', join(import.meta.dir, 'wringer-gunshi.ts'), 'guide', 'create', '--json'],
    cwd: folder,
  });

  expect({
    exitCode: result.exitCode,
    topic: envelopeSchema.parse(JSON.parse(result.stdout)).data,
    files: await readdir(folder),
  }).toStrictEqual({
    exitCode: 0,
    topic: expect.objectContaining({ topic: 'create' }),
    files: [],
  });
});

test('it labels the guide envelope with no commit even inside a git worktree', async () => {
  const repo = await createTestRepo(import.meta.dir);

  onTestFinished(() => repo.remove());

  const result = await runProcess({
    argv: ['bun', join(import.meta.dir, 'wringer-gunshi.ts'), 'guide', 'create', '--json'],
    cwd: repo.root,
  });

  expect({
    exitCode: result.exitCode,
    sha: envelopeSchema.parse(JSON.parse(result.stdout)).sha,
  }).toStrictEqual({ exitCode: 0, sha: null });
});
