import type { FingerprintHost } from './read-fingerprint.ts';

// The base a branch merges into: the remote's default branch when the clone knows it, else `main`.
// git exits non-zero when the clone has no remote default branch, which is a normal answer here.
export async function readDefaultBase(
  host: Pick<FingerprintHost, 'runGit'>,
  root: string,
): Promise<string> {
  try {
    const result = await host.runGit({
      cwd: root,
      args: ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
    });

    const base = result.stdout.trim();

    return base === '' ? 'main' : base;
  } catch {
    return 'main';
  }
}
