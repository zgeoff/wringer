import { join } from 'node:path';
import { match } from 'ts-pattern';
import type { FileSystem } from '../ci/file-system.ts';
import { makeLoggedCommandRunner } from '../ci/make-logged-command-runner.ts';
import { nodeFileSystem } from '../ci/node-file-system.ts';
import { runCheckedCommand } from '../ci/run-checked-command.ts';
import type { CommandResult, RunCommand } from '../ci/run-command.ts';
import { runCommand } from '../ci/run-command.ts';
import { parseTextList } from '../release/parse-text-list.ts';
import { parseTextRecord } from '../release/parse-text-record.ts';
import type { ManifestParse, PackageManifest } from './parse-package-manifest.ts';
import { parsePackageManifest } from './parse-package-manifest.ts';

export interface PackagesPublishOptions {
  readonly modeText: string;

  readonly cwd: string;

  readonly env: Readonly<Record<string, string | undefined>>;

  readonly pathsText: string;

  readonly releasedVersionsText: string;

  readonly fileSystem: Pick<FileSystem, 'readDirectory' | 'readText' | 'writeText' | 'removePath'>;

  // Runs the registry check, whose answer the publish reads.
  readonly runCommand: RunCommand;

  // Runs the build, pack and publish, whose output the log shows as each command writes it.
  readonly runLoggedCommand: RunCommand;

  readonly writeOutput: (text: string) => void;

  readonly writeError: (text: string) => void;
}

// npm publishes, not bun: trusted publishing (OIDC) needs npm 11.5.1 or newer, and bun publish has
// no OIDC support (oven-sh/bun#15601). bun packs, because it turns catalog: and workspace:
// versions into exact ones, which npm pack ships unchanged.
export async function publishPackages(options: PackagesPublishOptions): Promise<number> {
  const mode = parsePublishMode(options.modeText);

  if (mode === undefined) {
    options.writeError('::error::PUBLISH_MODE holds neither publish nor rehearse\n');

    return 1;
  }

  const pathsText = options.pathsText === '' ? '[]' : options.pathsText;
  const versionsText = options.releasedVersionsText === '' ? '{}' : options.releasedVersionsText;
  const listedPaths = parseTextList(pathsText);
  const releasedVersions = parseTextRecord(versionsText);

  if (listedPaths === null || releasedVersions === null) {
    options.writeError(
      '::error::PATHS_RELEASED holds no JSON array of paths, or RELEASED_VERSIONS no JSON object of versions\n',
    );

    return 1;
  }

  const paths =
    mode === 'rehearse' && listedPaths.length === 0
      ? await readWorkspacePackagePaths(options)
      : listedPaths;

  const parses = await Promise.all(
    paths.map(async (path): Promise<ManifestParse> => {
      const folder = join(options.cwd, path);

      const text = await options.fileSystem.readText(join(folder, 'package.json'));

      return parsePackageManifest(text, folder, releasedVersions[path]);
    }),
  );

  const manifests = parses.filter((parse): parse is PackageManifest => parse.kind !== 'invalid');

  // A tag whose version the checkout does not hold fails the run before anything publishes, which
  // the already-published skip would otherwise hide.
  const faults = [
    ...parses.flatMap((parse) => (parse.kind === 'invalid' ? [parse.message] : [])),
    ...manifests.flatMap((manifest) => collectVersionMismatches(manifest)),
  ];

  if (faults.length > 0) {
    for (const fault of faults) {
      options.writeError(`::error::${fault}\n`);
    }

    return 1;
  }

  for (const manifest of manifests) {
    await publishManifest(manifest, mode, options);
  }

  return 0;
}

// A rehearsal packs every package and runs npm's publish as a dry run, so a pull request proves
// the publish path without the OIDC token that provenance needs.
type PublishMode = 'publish' | 'rehearse';

function parsePublishMode(text: string): PublishMode | undefined {
  if (text === '' || text === 'publish') {
    return 'publish';
  }

  return text === 'rehearse' ? 'rehearse' : undefined;
}

// A rehearsal of an empty list covers every workspace package, so a new package joins it unlisted.
async function readWorkspacePackagePaths(options: PackagesPublishOptions): Promise<string[]> {
  const folders = await options.fileSystem.readDirectory(join(options.cwd, 'packages'));

  return folders.toSorted().map((folder) => `packages/${folder}`);
}

// A private package never publishes, so the release's version check covers public ones only.
function collectVersionMismatches(manifest: PackageManifest): string[] {
  return match(manifest)
    .with({ kind: 'private' }, () => [])
    .with({ kind: 'public' }, (entry) =>
      entry.releasedVersion === undefined || entry.releasedVersion === entry.version
        ? []
        : [
            `${entry.name}: the release tagged ${entry.releasedVersion} but ${join(entry.folder, 'package.json')} holds ${entry.version}`,
          ],
    )
    .exhaustive();
}

function publishManifest(
  manifest: PackageManifest,
  mode: PublishMode,
  options: PackagesPublishOptions,
): Promise<void> {
  return match(manifest)
    .with({ kind: 'private' }, (entry) => {
      options.writeOutput(`skipping ${entry.name}: private\n`);

      return Promise.resolve();
    })
    .with({ kind: 'public' }, (entry) => publishPackage(entry, mode, options))
    .exhaustive();
}

type PublicManifest = Extract<PackageManifest, { readonly kind: 'public' }>;

type RunChecked = (argv: readonly string[]) => Promise<CommandResult>;

async function publishPackage(
  entry: PublicManifest,
  mode: PublishMode,
  options: PackagesPublishOptions,
): Promise<void> {
  const commandOptions = { cwd: entry.folder, env: options.env };

  const run: RunChecked = (argv) =>
    runCheckedCommand(options.runLoggedCommand, argv, commandOptions);

  const isPublished = await match(mode)
    .with('publish', () => probePublishedVersion(entry, options))
    .with('rehearse', () => Promise.resolve(false))
    .exhaustive();

  if (isPublished) {
    options.writeOutput(`skipping ${entry.name}@${entry.version}: already published\n`);

    return;
  }

  if (entry.hasBuild) {
    await run(['bun', 'run', 'build']);
  }

  await packTarball(entry, mode, run, options);

  const files = await options.fileSystem.readDirectory(entry.folder);

  const tarballs = files.filter((file) => file.endsWith('.tgz'));
  const [tarball] = tarballs;

  if (tarballs.length !== 1 || tarball === undefined) {
    throw new Error(`bun pm pack left ${tarballs.length} tarballs in ${entry.folder}`);
  }

  // npm refuses to publish a prerelease without a dist-tag, even in a dry run.
  const flags = match(mode)
    .with('publish', () => ['--provenance'])
    .with('rehearse', () => ['--dry-run', '--tag', 'rehearsal'])
    .exhaustive();

  try {
    await run(['npm', 'publish', `./${tarball}`, ...flags, '--access', 'public']);
  } finally {
    await options.fileSystem.removePath(join(entry.folder, tarball));
  }
}

// The registry check makes a rerun after a partial publish skip the packages already on npm.
async function probePublishedVersion(
  entry: PublicManifest,
  options: PackagesPublishOptions,
): Promise<boolean> {
  const published = await options.runCommand(
    ['npm', 'view', `${entry.name}@${entry.version}`, 'version'],
    { cwd: entry.folder, env: options.env },
  );

  return published.stdout.trim() === entry.version;
}

// npm's dry run refuses a version the registry holds, so a rehearsal packs a prerelease of the
// version that no release publishes, and puts the manifest back after the pack.
async function packTarball(
  entry: PublicManifest,
  mode: PublishMode,
  run: RunChecked,
  options: PackagesPublishOptions,
): Promise<void> {
  await match(mode)
    .with('publish', () => run(['bun', 'pm', 'pack']))
    .with('rehearse', async () => {
      const manifestPath = join(entry.folder, 'package.json');

      const manifestText = await options.fileSystem.readText(manifestPath);

      await options.fileSystem.writeText(
        manifestPath,
        buildRehearsalManifestText(manifestText, entry.version),
      );

      try {
        await run(['bun', 'pm', 'pack']);
      } finally {
        await options.fileSystem.writeText(manifestPath, manifestText);
      }
    })
    .exhaustive();
}

function buildRehearsalManifestText(manifestText: string, version: string): string {
  const manifest: unknown = JSON.parse(manifestText);

  if (typeof manifest !== 'object' || manifest === null) {
    throw new Error('package.json holds no JSON object');
  }

  return `${JSON.stringify({ ...manifest, version: `${version}-rehearsal` }, null, 2)}\n`;
}

if (import.meta.main) {
  process.exitCode = await publishPackages({
    modeText: process.env['PUBLISH_MODE'] ?? '',
    cwd: process.cwd(),
    env: process.env,
    pathsText: process.env['PATHS_RELEASED'] ?? '',
    releasedVersionsText: process.env['RELEASED_VERSIONS'] ?? '',
    fileSystem: nodeFileSystem,
    runCommand,
    runLoggedCommand: makeLoggedCommandRunner({ stdout: process.stdout, stderr: process.stderr }),
    writeOutput: (text) => {
      process.stdout.write(text);
    },
    writeError: (text) => {
      process.stderr.write(text);
    },
  });
}
