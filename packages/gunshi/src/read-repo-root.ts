import { WringerError } from '@wringer/core';

// The run state lives at the top of the worktree, wherever in it the command starts.
export async function readRepoRoot(cwd: string): Promise<string | WringerError> {
  const child = Bun.spawn(['git', 'rev-parse', '--show-toplevel'], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'ignore',
  });

  const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);

  if (exitCode !== 0) {
    return new WringerError('environment', {
      message: `${cwd} is not inside a git worktree.`,
      hint: 'Run the command from inside the repo.',
    });
  }

  return stdout.trim();
}
