import { runProcess } from './run-process.ts';

// The base a branch merges into: the remote's default branch when the clone knows it, else `main`.
export async function readDefaultBase(root: string): Promise<string> {
  const result = await runProcess({
    argv: ['git', 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
    cwd: root,
  });

  const base = result.stdout.trim();

  return result.exitCode === 0 && base !== '' ? base : 'main';
}
