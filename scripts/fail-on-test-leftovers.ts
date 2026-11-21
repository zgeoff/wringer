import { afterAll } from 'bun:test';
import { tmpdir } from 'node:os';
import { nodeFileSystem } from './ci/node-file-system.ts';
import { readTestRunOwner } from './remove-stale-test-folders.ts';
import { readProcesses, runTestLeftoversCheck, stopProcess } from './run-test-leftovers-check.ts';

// A hook in the test preload runs once, after the last test file of the run.
afterAll(async () => {
  const leftovers = await runTestLeftoversCheck({
    root: tmpdir(),
    owner: readTestRunOwner(),
    fileSystem: nodeFileSystem,
    readProcesses,
    stopProcess,
    exitWaitMs: 1500,
  });

  const lines = [
    ...leftovers.processes.map((line) => `a process, stopped now: ${line.pid} ${line.args}`),
    ...leftovers.folders.map((folder) => `a test folder, removed now: ${folder}`),
  ];

  if (lines.length > 0) {
    throw new Error(
      `These outlived their tests; each test must stop what it starts and remove its folder:\n${lines.join('\n')}`,
    );
  }
});
