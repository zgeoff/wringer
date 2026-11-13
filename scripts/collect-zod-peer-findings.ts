import { isRecord } from './dependency-gates/is-record.ts';

export interface PackageManifest {
  readonly path: string;
  readonly manifest: unknown;
}

const expectedZodRanges = [
  { field: 'peerDependencies', range: '^4.0.0' },
  { field: 'dependencies', range: undefined },
  { field: 'devDependencies', range: 'catalog:' },
] as const;

export function collectZodPeerFindings(manifests: readonly PackageManifest[]): string[] {
  const published = manifests.filter(
    (entry) => !isRecord(entry.manifest) || entry.manifest['private'] !== true,
  );

  if (published.length === 0) {
    return ['packages: no published package manifest found'];
  }

  return published.flatMap((entry) =>
    expectedZodRanges.flatMap((expected) => {
      const range = findZodRange(entry.manifest, expected.field);

      return range === expected.range
        ? []
        : [
            `${entry.path}: ${expected.field}.zod is ${formatRange(range)}, expected ${formatRange(expected.range)}`,
          ];
    }),
  );
}

function findZodRange(manifest: unknown, field: string): unknown {
  const section = isRecord(manifest) ? manifest[field] : undefined;

  return isRecord(section) ? section['zod'] : undefined;
}

function formatRange(range: unknown): string {
  return range === undefined ? 'absent' : JSON.stringify(range);
}
