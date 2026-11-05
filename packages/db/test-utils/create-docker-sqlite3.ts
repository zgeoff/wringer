import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const image = 'wringer-test-sqlite3:1';

const dockerfile = `FROM alpine:3.22
RUN apk add --no-cache sqlite
`;

// The real sqlite3 shell, in a container, for hosts without it. The container sees `directory` at
// the same path and runs as the caller's user, so a file any command writes lands where the test
// reads it, and the test can remove it.
export async function createDockerSqlite3(directory: string): Promise<string> {
  const built = Bun.spawnSync(['docker', 'build', '--quiet', '--tag', image, '-'], {
    stdin: new TextEncoder().encode(dockerfile),
  });

  if (built.exitCode !== 0) {
    throw new Error(`docker build failed: ${built.stderr.toString()}`);
  }

  const user = `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`;
  const path = join(directory, 'sqlite3');

  await writeFile(
    path,
    `#!/bin/sh\nexec docker run --rm -i --network none --user ${user} --volume '${directory}:${directory}' ${image} sqlite3 "$@"\n`,
  );

  await chmod(path, 0o755);

  return path;
}
