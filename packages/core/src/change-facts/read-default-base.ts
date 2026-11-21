import type { ChangeFactsHost } from './read-change-facts.ts';

// The base a branch merges into: `origin/HEAD`, else `origin/main`, else `main`. A local `main`
// lags the remote until someone pulls. git exits non-zero for a ref the clone lacks, a normal answer.
export async function readDefaultBase(
  host: Pick<ChangeFactsHost, 'runGit'>,
  root: string,
): Promise<string> {
  const remoteDefault = await readRemoteDefault(host, root);

  if (remoteDefault !== null) {
    return remoteDefault;
  }

  const hasRemoteMain = await probeRef(host, root, 'refs/remotes/origin/main');

  return hasRemoteMain ? 'origin/main' : 'main';
}

async function readRemoteDefault(
  host: Pick<ChangeFactsHost, 'runGit'>,
  root: string,
): Promise<string | null> {
  try {
    const result = await host.runGit({
      cwd: root,
      args: ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
    });

    const base = result.stdout.trim();

    return base === '' ? null : base;
  } catch {
    return null;
  }
}

async function probeRef(
  host: Pick<ChangeFactsHost, 'runGit'>,
  root: string,
  ref: string,
): Promise<boolean> {
  try {
    await host.runGit({ cwd: root, args: ['rev-parse', '--verify', '--quiet', ref] });

    return true;
  } catch {
    return false;
  }
}
