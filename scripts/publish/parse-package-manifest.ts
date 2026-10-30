// A private package never publishes, so it needs no version; only a public one's publish metadata
// is checked.
export type PackageManifest =
  | { readonly kind: 'private'; readonly folder: string; readonly name: string }
  | {
      readonly kind: 'public';
      readonly folder: string;
      readonly name: string;
      readonly version: string;
      readonly hasBuild: boolean;
      readonly releasedVersion: string | undefined;
    };

export type ManifestParse =
  | PackageManifest
  | { readonly kind: 'invalid'; readonly message: string };

export function parsePackageManifest(
  text: string,
  folder: string,
  releasedVersion: string | undefined,
): ManifestParse {
  const manifest = parseJSON(text);

  if (typeof manifest !== 'object' || manifest === null) {
    return { kind: 'invalid', message: `${folder}/package.json holds no JSON object` };
  }

  const name = 'name' in manifest ? manifest.name : undefined;

  if ('private' in manifest && manifest.private === true) {
    return { kind: 'private', folder, name: typeof name === 'string' ? name : folder };
  }

  const version = 'version' in manifest ? manifest.version : undefined;

  if (typeof name !== 'string' || typeof version !== 'string') {
    return { kind: 'invalid', message: `${folder}/package.json names no package and version` };
  }

  const scripts = 'scripts' in manifest ? manifest.scripts : undefined;

  return {
    kind: 'public',
    folder,
    name,
    version,
    hasBuild: typeof scripts === 'object' && scripts !== null && 'build' in scripts,
    releasedVersion,
  };
}

function parseJSON(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text);

    return parsed;
  } catch {
    return undefined;
  }
}
