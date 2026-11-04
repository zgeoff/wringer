import { WringerError, runProcess } from '@wringer/core';
import type { ProcessResult } from '@wringer/core';

// The run state lives at the top of the worktree, wherever in it the command starts.
export async function readRepoRoot(cwd: string): Promise<string | WringerError> {
  const result = await readTopLevel(cwd);

  if (result instanceof WringerError) {
    return result;
  }

  if (result.exitCode !== 0) {
    return new WringerError('environment', {
      message: `${cwd} is not inside a git worktree.`,
      hint: 'Run the command from inside the repo.',
    });
  }

  return result.stdout.trim();
}

// A git that fails to start, or a folder that does not exist, fails the run with an environment
// error, which the caller answers like any other.
async function readTopLevel(cwd: string): Promise<ProcessResult | WringerError> {
  try {
    return await runProcess({ argv: ['git', 'rev-parse', '--show-toplevel'], cwd });
  } catch (error) {
    if (error instanceof WringerError) {
      return error;
    }

    throw error;
  }
}
