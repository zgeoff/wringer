import { match } from 'ts-pattern';
import type { PackageManifest } from './parse-package-manifest.ts';
import type { PublishMode } from './parse-publish-request.ts';

type PublicManifest = Extract<PackageManifest, { readonly kind: 'public' }>;

export interface PackageSteps {
  readonly probeRegistry: boolean;

  readonly build: boolean;

  // The version the manifest holds while bun packs it, or null to pack the manifest as it is.
  readonly packVersion: string | null;

  readonly publishArgs: readonly string[];
}

// npm's dry run refuses a version the registry holds, so a rehearsal packs a prerelease of the
// version that no release publishes. npm refuses a prerelease without a dist-tag, even in a dry
// run. The registry check makes a rerun after a partial publish skip the packages already on npm.
export function buildPackageSteps(entry: PublicManifest, mode: PublishMode): PackageSteps {
  return match(mode)
    .with('publish', () => ({
      probeRegistry: true,
      build: entry.hasBuild,
      packVersion: null,
      publishArgs: ['--provenance', '--access', 'public'],
    }))
    .with('rehearse', () => ({
      probeRegistry: false,
      build: entry.hasBuild,
      packVersion: `${entry.version}-rehearsal`,
      publishArgs: ['--dry-run', '--tag', 'rehearsal', '--access', 'public'],
    }))
    .exhaustive();
}
