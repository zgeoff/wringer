export interface RawEntry {
  // The status letter git gives: `A`, `M`, `D`, `T` and so on.
  readonly status: string;

  // The path as git wrote it, as bytes.
  readonly path: Buffer;
}

// Reads the output of `git diff --raw -z --no-renames`: a `:mode mode id id status` field, then
// the path, each ended by a NUL byte.
export function parseRawEntries(output: Uint8Array): readonly RawEntry[] {
  const fields = splitFields(Buffer.from(output));
  const entries: RawEntry[] = [];

  for (let index = 0; index < fields.length; index += 2) {
    const info = fields[index]?.toString('latin1') ?? '';
    const path = fields[index + 1];

    if (!info.startsWith(':') || path === undefined) {
      throw new Error('The diff listed a change without a status and a path.');
    }

    entries.push({ status: info.slice(info.lastIndexOf(' ') + 1), path });
  }

  return entries;
}

function splitFields(bytes: Buffer): readonly Buffer[] {
  const fields: Buffer[] = [];
  let start = 0;

  while (start < bytes.length) {
    const end = bytes.indexOf(0, start);
    const stop = end === -1 ? bytes.length : end;

    fields.push(bytes.subarray(start, stop));

    start = stop + 1;
  }

  return fields;
}
