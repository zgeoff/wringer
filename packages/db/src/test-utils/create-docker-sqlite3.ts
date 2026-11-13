import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DockerImage } from '@wringer/core/test-utils/create-docker-image.ts';
import { createDockerImage } from '@wringer/core/test-utils/create-docker-image.ts';

export const testSqlite3Image: DockerImage = {
  tag: 'wringer-test-sqlite3:1',
  dockerfile: `FROM alpine:3.22
RUN apk add --no-cache sqlite
`,
};

// The real sqlite3 shell, in a container, for hosts without it. The container sees `directory` at
// the same path and runs as the caller's user, so a file any command writes lands where the test
// reads it, and the test can remove it.
export async function createDockerSqlite3(directory: string): Promise<string> {
  await createDockerImage(testSqlite3Image);

  const user = `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`;
  const path = join(directory, 'sqlite3');

  await writeFile(
    path,
    `#!/bin/sh\nexec docker run --rm -i --network none --user ${user} --volume '${directory}:${directory}' ${testSqlite3Image.tag} sqlite3 "$@"\n`,
  );

  await chmod(path, 0o755);

  return path;
}
