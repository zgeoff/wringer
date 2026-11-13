// The same `git diff --raw --patch -z` output with its files in the opposite order: the raw entries
// end at the first double NUL, and each file of the patch starts at a `diff --git` line. latin1
// maps each byte to one character, so the bytes of a binary patch survive.
export function reverseDiffFiles(output: Uint8Array): Uint8Array {
  const text = Buffer.from(output).toString('latin1');
  const split = text.indexOf('\0\0');
  const raw = split === -1 ? '' : text.slice(0, split);
  const patch = split === -1 ? text : text.slice(split + 2);
  const fields = raw === '' ? [] : raw.split('\0');

  const entries = Array.from({ length: fields.length / 2 }, (_, index) =>
    fields.slice(index * 2, index * 2 + 2).join('\0'),
  );

  const files = patch.split(/(?=^diff --git )/mu);
  const reversedRaw = entries.toReversed().join('\0');

  return Buffer.from(
    `${reversedRaw}${split === -1 ? '' : '\0\0'}${files.toReversed().join('')}`,
    'latin1',
  );
}
