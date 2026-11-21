import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createTempDir } from '@zgeoff/testing/fs';
import { nodeFileSystem } from './ci/node-file-system.ts';
import type { ProcessLine } from './run-test-leftovers-check.ts';
import {
  parseProcessLines,
  pickLeftoverFolders,
  pickLeftoverProcesses,
  runTestLeftoversCheck,
} from './run-test-leftovers-check.ts';

function setupTest() {
  const root = createTempDir('run-test-leftovers-check').path;
  const stopped: string[] = [];

  return {
    root,
    stopped,
    runCheck: (readProcesses: () => readonly ProcessLine[]) =>
      runTestLeftoversCheck({
        root,
        owner: { namespace: '4026531836', pid: 4100 },
        fileSystem: nodeFileSystem,
        readProcesses,
        stopProcess: (pid, signal) => {
          stopped.push(`${pid} ${signal}`);
        },
        exitWaitMs: 300,
      }),
  };
}

test.each([
  {
    args: 'bun cli.ts __wringer-supervisor run-1 prod /repo/repopid4100-ns4026531836-a1b2c3',
    leftover: true,
  },
  {
    args: 'bun cli.ts __wringer-supervisor run-1 prod /repo/repopid4200-ns4026531836-a1b2c3',
    leftover: false,
  },
  {
    args: 'bun cli.ts __wringer-supervisor run-1 prod /repo/repopid4100-ns4026532001-a1b2c3',
    leftover: false,
  },
  {
    args: 'bun /repo/cli.ts __wringer-supervisor run-1 prod /elsewhere/repopid4100-ns4026531836-a1b2c3',
    leftover: false,
  },
  {
    args: 'bun cli.ts __wringer-supervisor run-1 prod /work/repo/repopid4100-ns4026531836-a1b2c3',
    leftover: false,
  },
  { args: 'bun cli.ts __wringer-supervisor run-1 prod /repo', leftover: false },
])('#pickLeftoverProcesses reads $args as a leftover: $leftover', (row) => {
  const picked = pickLeftoverProcesses([{ pid: 5200, args: row.args }], {
    root: '/repo',
    owner: { namespace: '4026531836', pid: 4100 },
  });

  expect(picked.length > 0).toBe(row.leftover);
});

test('#pickLeftoverProcesses finds a test folder under a root whose path holds a space', () => {
  const picked = pickLeftoverProcesses(
    [
      {
        pid: 5200,
        args: 'bun cli.ts __wringer-supervisor run-1 prod /my repo/repopid4100-ns4026531836-a1b2c3',
      },
    ],
    { root: '/my repo', owner: { namespace: '4026531836', pid: 4100 } },
  );

  expect(picked.map((line) => line.pid)).toStrictEqual([5200]);
});

test.each([
  { name: 'repopid4100-ns4026531836-a1b2c3', leftover: true },
  { name: 'repopid4200-ns4026531836-a1b2c3', leftover: false },
  { name: 'repopid4100-ns4026532001-a1b2c3', leftover: false },
  { name: 'repo-a1b2c3', leftover: false },
])('#pickLeftoverFolders reads $name as a leftover: $leftover', (row) => {
  const picked = pickLeftoverFolders([{ name: row.name, path: `/repo/${row.name}` }], {
    owner: { namespace: '4026531836', pid: 4100 },
  });

  expect(picked.length > 0).toBe(row.leftover);
});

test('#parseProcessLines reads the PID and the arguments of each line ps prints', () => {
  const lines = parseProcessLines('    1 /sbin/init\n 5200 bun cli.ts  status\n\n');

  expect(lines).toStrictEqual([
    { pid: 1, args: '/sbin/init' },
    { pid: 5200, args: 'bun cli.ts  status' },
  ]);
});

test('it stops a process that still names a test folder of the owner, and removes the folder', async () => {
  const ctx = setupTest();
  const folder = join(ctx.root, 'repopid4100-ns4026531836-a1b2c3');

  await mkdir(folder, { recursive: true });

  const leftovers = await ctx.runCheck(() =>
    ctx.stopped.length === 0
      ? [{ pid: 5200, args: `bun cli.ts __wringer-supervisor run-1 prod ${folder}` }]
      : [],
  );

  expect({ leftovers, stopped: ctx.stopped, folderExists: existsSync(folder) }).toStrictEqual({
    leftovers: {
      processes: [{ pid: 5200, args: `bun cli.ts __wringer-supervisor run-1 prod ${folder}` }],
      folders: [folder],
    },
    stopped: ['5200 SIGTERM'],
    folderExists: false,
  });
});

test('it kills a leftover process that still runs after the stop', async () => {
  const ctx = setupTest();
  const folder = join(ctx.root, 'repopid4100-ns4026531836-a1b2c3');

  await ctx.runCheck(() => [
    { pid: 5200, args: `bun cli.ts __wringer-supervisor run-1 prod ${folder}` },
  ]);

  expect(ctx.stopped).toStrictEqual(['5200 SIGTERM', '5200 SIGKILL']);
});

test('it reports no leftover for a process that exits within the wait', async () => {
  const ctx = setupTest();
  const folder = join(ctx.root, 'repopid4100-ns4026531836-a1b2c3');

  const reads: (readonly ProcessLine[])[] = [
    [{ pid: 5200, args: `bun cli.ts __wringer-supervisor run-1 prod ${folder}` }],
    [],
  ];

  const leftovers = await ctx.runCheck(() => reads.shift() ?? []);

  expect({ leftovers, stopped: ctx.stopped }).toStrictEqual({
    leftovers: { processes: [], folders: [] },
    stopped: [],
  });
});
