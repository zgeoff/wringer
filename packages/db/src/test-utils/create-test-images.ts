import { createDockerImage } from '@wringer/core/test-utils/create-docker-image.ts';
import { testSSHPostgresImage } from '@wringer/core/test-utils/create-test-ssh-postgres.ts';
import { testSqlite3Image } from './create-docker-sqlite3.ts';
import { testPostgresImage } from './create-test-postgres.ts';

// The docker lane runs this before its tests. A cold build can outlast a test's timeout, and a
// build cut off mid-way can corrupt the builder's state for every later build.
await Promise.all(
  [testSSHPostgresImage, testPostgresImage, testSqlite3Image].map((image) =>
    createDockerImage(image),
  ),
);
