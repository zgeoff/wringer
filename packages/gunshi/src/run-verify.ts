import type { Wringer } from '@wringer/core';
import { getAgentProfile } from 'gunshi/agent';
import { runCLI } from './run-cli.ts';

// The repo's verify script calls this with its registry. The script restarts itself as the run's
// supervisor, so `selfCommand` is the runtime and the script, without the user's arguments.
export async function runVerify(wringer: Wringer): Promise<void> {
  const [, script] = process.argv;

  process.exitCode = await runCLI(wringer, {
    argv: process.argv.slice(2),
    cwd: process.cwd(),
    isTTY: process.stdout.isTTY,
    isAgent: getAgentProfile().isAgent,
    selfCommand: script === undefined ? [process.execPath] : [process.execPath, script],
    writeStdout: (text) => {
      process.stdout.write(text);
    },
  });
}
