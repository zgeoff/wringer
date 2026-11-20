// Reads the output of `git diff --name-status -z -M`: a status field, then one path, or two for a
// rename or a copy, each ended by a NUL byte. Returns the source path of each rename.
export function parseRenamedFrom(output: Uint8Array): readonly string[] {
  const fields = Buffer.from(output).toString('utf8').split('\0');
  const sources: string[] = [];
  let index = 0;

  while (index < fields.length) {
    const status = fields[index] ?? '';
    const isPair = status.startsWith('R') || status.startsWith('C');
    const source = fields[index + 1];

    if (status.startsWith('R') && source !== undefined) {
      sources.push(source);
    }

    index += isPair ? 3 : 2;
  }

  return sources;
}
