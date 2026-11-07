// The same diff with its files in the opposite order: each file starts at a `diff --git` line.
// latin1 maps each byte to one character, so the bytes of a binary patch survive.
export function reverseDiffFiles(diff: Uint8Array): Uint8Array {
  const files = Buffer.from(diff)
    .toString('latin1')
    .split(/(?=^diff --git )/mu);

  return Buffer.from(files.toReversed().join(''), 'latin1');
}
