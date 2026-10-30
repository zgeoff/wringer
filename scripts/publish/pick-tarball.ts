export type TarballPick =
  | { readonly kind: 'found'; readonly tarball: string }
  | { readonly kind: 'refused'; readonly message: string };

export function pickTarball(files: readonly string[], folder: string): TarballPick {
  const tarballs = files.filter((file) => file.endsWith('.tgz'));
  const [tarball] = tarballs;

  if (tarballs.length !== 1 || tarball === undefined) {
    return {
      kind: 'refused',
      message: `bun pm pack left ${tarballs.length} tarballs in ${folder}`,
    };
  }

  return { kind: 'found', tarball };
}
