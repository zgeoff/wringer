// The paths in the output of `git status --porcelain=v1 -z`: each entry reads `XY path`, and a
// rename or copy is followed by the path it came from.
export function parseStatusPaths(output: Uint8Array): readonly string[] {
  const fields = Buffer.from(output).toString('utf8').split('\0');
  const paths: string[] = [];

  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index] ?? '';

    if (field.length < 4) {
      continue;
    }

    paths.push(field.slice(3));

    if (/^(?:[RC]|.[RC])/u.test(field)) {
      index += 1;

      paths.push(fields[index] ?? '');
    }
  }

  return paths.filter((path) => path.length > 0).toSorted();
}
