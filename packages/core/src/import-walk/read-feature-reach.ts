import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { RegisteredFeature } from '../feature-definition.ts';
import { isErrorCode } from '../is-error-code.ts';
import type { RepoHost } from '../types.ts';
import { buildWalkKey } from './build-walk-key.ts';
import { collectEntryFiles } from './collect-entry-files.ts';
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

  if (cached !== null && walked.every((feature) => cached[feature.name] !== undefined)) {
    return new Map(walked.map((feature) => [feature.name, cached[feature.name] ?? emptyReach]));
  }

  const files = await readTrackedFiles(host, request.root);

  const reach: Record<string, FeatureReach> = {};

  for (const feature of walked) {
    reach[feature.name] = await readReachedFiles(host, {
      root: request.root,
      entryFiles: collectEntryFiles(files, feature.entries),
    });
  }

  // Only the newest walk stays, so the folder never grows past one file.
  await host.removeDirectory(folder);
  await host.createDirectory(folder);
  await host.writeNewFile(cachePath, Buffer.from(JSON.stringify(reach), 'utf8'));

  return new Map(Object.entries(reach));
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
    entries: walked.map((feature) => [feature.name, feature.entries] as const),
    changed,
  });
}

async function readDigest(host: RepoHost, path: string): Promise<string | null> {
  try {
    const bytes = await host.readBytes(path);

    return createHash('sha256').update(bytes).digest('hex');
  } catch (error) {
    if (isErrorCode(error, 'ENOENT') || isErrorCode(error, 'EISDIR')) {
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
