import { join } from 'node:path';
import { P, match } from 'ts-pattern';
import type { ManifestParse, PackageManifest } from './parse-package-manifest.ts';

export type PublishPlan =
  | { readonly kind: 'ready'; readonly manifests: readonly PackageManifest[] }
  | { readonly kind: 'refused'; readonly faults: readonly string[] };

// A tag whose version the checkout does not hold refuses the whole run before anything publishes,
// which the already-published skip would otherwise hide.
export function buildPublishPlan(parses: readonly ManifestParse[]): PublishPlan {
  const manifests = parses.flatMap((parse) =>
    match(parse)
      .with({ kind: 'invalid' }, () => [])
      .with({ kind: P.union('private', 'public') }, (manifest) => [manifest])
      .exhaustive(),
  );

  const faults = [
    ...parses.flatMap((parse) =>
      match(parse)
        .with({ kind: 'invalid' }, (invalid) => [invalid.message])
        .with({ kind: P.union('private', 'public') }, () => [])
        .exhaustive(),
    ),
    ...manifests.flatMap((manifest) => collectVersionMismatches(manifest)),
  ];

  return faults.length > 0 ? { kind: 'refused', faults } : { kind: 'ready', manifests };
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
