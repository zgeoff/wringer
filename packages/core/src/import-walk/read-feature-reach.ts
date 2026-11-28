import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { RegisteredFeature } from '../feature-definition.ts';
import { isErrorCode } from '../is-error-code.ts';
import type { RepoHost } from '../types.ts';
import { buildWalkKey } from './build-walk-key.ts';
import { collectEntryFiles } from './collect-entry-files.ts';
import { isMissingFile } from './is-missing-file.ts';
import { parseStatusPaths } from './parse-status-paths.ts';
import { parseWalkCache } from './parse-walk-cache.ts';
import type { FeatureReach, WalkCache } from './parse-walk-cache.ts';
import { readReachedFiles } from './read-reached-files.ts';

export interface FeatureReachRequest {
  readonly root: string;
  readonly stateDir: string;
  readonly features: readonly Pick<RegisteredFeature, 'name' | 'entries'>[];
}

const cacheFolder = 'import-walk';
const emptyReach: FeatureReach = { reached: [], warnings: [] };

// The files each feature with `entries` reaches. The walk is saved in the state folder under a key
// of the commit and of every file that differs from it, so a second read of the same tree parses
// nothing. A feature with no `entries` is left out of the map.
export async function readFeatureReach(
  host: RepoHost,
  request: FeatureReachRequest,
): Promise<ReadonlyMap<string, FeatureReach>> {
  const walked = request.features.filter((feature) => feature.entries.length > 0);

  if (walked.length === 0) {
    return new Map();
  }

  const folder = join(request.root, request.stateDir, cacheFolder);

  const key = await readKey(host, request.root, walked);

  const cachePath = join(folder, `${key}.json`);

  const cached = await readCache(host, cachePath);

  if (cached !== null && walked.every((feature) => cached.has(feature.name))) {
    return new Map(walked.map((feature) => [feature.name, cached.get(feature.name) ?? emptyReach]));
  }

  const files = await readTrackedFiles(host, request.root);

  const reach = new Map<string, FeatureReach>();

  for (const feature of walked) {
    const reached = await readReachedFiles(host, {
      root: request.root,
      entryFiles: collectEntryFiles(files, feature.entries),
    });

    reach.set(feature.name, reached);
  }

  await writeCache(host, { folder, cachePath, reach });

  return reach;
}

async function readKey(
  host: RepoHost,
  root: string,
  walked: readonly Pick<RegisteredFeature, 'name' | 'entries'>[],
): Promise<string> {
  const head = await host.runGit({ cwd: root, args: ['rev-parse', 'HEAD'] });

  const status = await host.runGitBytes({
    cwd: root,
    args: ['--no-optional-locks', 'status', '--porcelain=v1', '-z', '--untracked-files=all'],
  });

  const changed = await Promise.all(
    parseStatusPaths(status).map(
      async (path) => [path, await readDigest(host, join(root, path))] as const,
    ),
  );

  return buildWalkKey({
    head: head.stdout.trim(),
    status: createHash('sha256').update(status).digest('hex'),
    entries: walked.map((feature) => [feature.name, feature.entries] as const),
    changed,
  });
}

async function readDigest(host: RepoHost, path: string): Promise<string | null> {
  try {
    const bytes = await host.readBytes(path);

    return createHash('sha256').update(bytes).digest('hex');
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }

    throw error;
  }
}

async function readCache(host: RepoHost, path: string): Promise<WalkCache | null> {
  try {
    const bytes = await host.readBytes(path);

    return parseWalkCache(Buffer.from(bytes).toString('utf8'));
  } catch (error) {
    if (isErrorCode(error, 'ENOENT')) {
      return null;
    }

    throw error;
  }
}

// Every file git lists, tracked or not, that an ignore rule leaves in: a new file a change adds is
// one an entry may name.
async function readTrackedFiles(host: RepoHost, root: string): Promise<readonly string[]> {
  const output = await host.runGitBytes({
    cwd: root,
    args: ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  });

  return Buffer.from(output)
    .toString('utf8')
    .split('\0')
    .filter((path) => path.length > 0)
    .toSorted();
}

interface CacheWrite {
  readonly folder: string;
  readonly cachePath: string;
  readonly reach: ReadonlyMap<string, FeatureReach>;
}

// Only the newest walk stays. Two commands that walk at once can remove each other's folder, and a
// walk that loses the race goes without its cache file, with the right result.
async function writeCache(host: RepoHost, request: CacheWrite): Promise<void> {
  try {
    await host.removeDirectory(request.folder);
    await host.createDirectory(request.folder);
    await host.writeNewFile(request.cachePath, Buffer.from(JSON.stringify([...request.reach])));
  } catch (error) {
    if (!isErrorCode(error, 'ENOENT')) {
      throw error;
    }
  }
}
