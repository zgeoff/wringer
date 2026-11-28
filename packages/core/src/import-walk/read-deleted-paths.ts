import type { RepoHost, Wringer } from '../types.ts';

export interface DeletedPathsRequest {
  readonly wringer: Pick<Wringer, 'features'>;
  readonly root: string;
  readonly changedPaths: readonly string[];
}

// The changed paths that no longer exist on disk, for a registry whose features name `entries`. No
// walk reaches a deleted file, so it would count as unmapped with nothing a glob could fix. A
// registry with only `paths` gets none, so its deletions keep needing a glob.
export async function readDeletedPaths(
  host: RepoHost,
  request: DeletedPathsRequest,
): Promise<readonly string[]> {
  if (!request.wringer.features.some((feature) => feature.entries.length > 0)) {
    return [];
  }

  const facts = await Promise.all(
    request.changedPaths.map(
      async (path) => [path, await host.inspectFile(`${request.root}/${path}`)] as const,
    ),
  );

  return facts.filter(([, found]) => found === null).map(([path]) => path);
}
