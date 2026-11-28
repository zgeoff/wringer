import type { RepoHost, Wringer } from '../types.ts';
import { isMissingFile } from './is-missing-file.ts';

export interface DeletedPathsRequest {
  readonly wringer: Pick<Wringer, 'features'>;
  readonly root: string;
  readonly changedPaths: readonly string[];
}

// The changed paths that git no longer lists as a file of the worktree, for a registry whose
// features name `entries`. No walk reaches a deleted file, so no glob could map it. A registry with
// only `paths` gets none.
export async function readDeletedPaths(
  host: RepoHost,
  request: DeletedPathsRequest,
): Promise<readonly string[]> {
  if (!request.wringer.features.some((feature) => feature.entries.length > 0)) {
    return [];
  }

  const listed = await host.runGitBytes({
    cwd: request.root,
    args: ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  });

  const missing = await host.runGitBytes({
    cwd: request.root,
    args: ['ls-files', '--deleted', '-z'],
  });

  const present = new Set(parseNulList(listed));

  for (const path of parseNulList(missing)) {
    present.delete(path);
  }

  const absent = request.changedPaths.filter((path) => !present.has(path));

  // A file that `.git/info/exclude` hides is absent from the list but still counts as changed.
  const found = await Promise.all(
    absent.map(async (path) => [path, await probeFile(host, `${request.root}/${path}`)] as const),
  );

  return found.filter(([, exists]) => !exists).map(([path]) => path);
}

function parseNulList(output: Uint8Array): readonly string[] {
  return Buffer.from(output)
    .toString('utf8')
    .split('\0')
    .filter((path) => path.length > 0);
}

async function probeFile(host: RepoHost, path: string): Promise<boolean> {
  try {
    return (await host.inspectFile(path)) !== null;
  } catch (error) {
    if (isMissingFile(error)) {
      return false;
    }

    throw error;
  }
}
