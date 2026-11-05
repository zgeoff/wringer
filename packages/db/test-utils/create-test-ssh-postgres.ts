import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { waitFor } from '../../core/test-utils/wait-for.ts';

export interface TestSSHPostgres {
  readonly url: string;
  readonly sshBinary: string;
  readonly destination: string;
  readonly containerID: string;
  readonly remove: () => void;
}

const image = 'wringer-test-ssh-postgres:2';

// Postgres with sshd beside it, so psql runs on the "remote" host the way a `via: 'exec'` target
// over ssh runs it. psql reaches the database over its local socket, which the image trusts.
const dockerfile = `FROM postgres:17-alpine
RUN apk add --no-cache openssh && ssh-keygen -A && adduser -D -h /srv/shop shop && passwd -u shop
CMD ["sh", "-c", "mkdir -p /srv/shop/.ssh && cp /run/key.pub /srv/shop/.ssh/authorized_keys && chown -R shop /srv/shop/.ssh && /usr/sbin/sshd && exec docker-entrypoint.sh postgres"]
`;

// `directory` holds the key pair and an ssh wrapper that passes the key and the port, so the
// caller's ssh host needs only `binary` and `destination`.
export async function createTestSSHPostgres(directory: string): Promise<TestSSHPostgres> {
  const built = Bun.spawnSync(['docker', 'build', '--quiet', '--tag', image, '-'], {
    stdin: new TextEncoder().encode(dockerfile),
  });

  if (built.exitCode !== 0) {
    throw new Error(`docker build failed: ${built.stderr.toString()}`);
  }

  const key = join(directory, 'key');

  Bun.spawnSync(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', key]);

  const started = Bun.spawnSync([
    'docker',
    'run',
    '--detach',
    '--rm',

    // A process an ssh session leaves behind is reparented to PID 1. Postgres as PID 1 reads its
    // exit as a crashed backend and restarts, cutting every connection, so tini reaps it instead.
    '--init',
    '--env',
    'POSTGRES_USER=shop',
    '--env',
    'POSTGRES_PASSWORD=shop',
    '--volume',
    `${key}.pub:/run/key.pub:ro`,
    '--publish',
    '127.0.0.1::5432',
    '--publish',
    '127.0.0.1::22',
    image,
  ]);

  if (started.exitCode !== 0) {
    throw new Error(`docker run failed: ${started.stderr.toString()}`);
  }

  const id = started.stdout.toString().trim();

  const remove = (): void => {
    // A forced removal keeps the image's anonymous data volume unless it names `--volumes`.
    Bun.spawnSync(['docker', 'rm', '--force', '--volumes', id]);
  };

  try {
    const readPort = (port: string): string =>
      Bun.spawnSync(['docker', 'port', id, port])
        .stdout.toString()
        .trim()
        .split('\n')[0]
        ?.split(':')
        .at(-1) ?? '';

    const sshBinary = join(directory, 'ssh');

    await writeFile(
      sshBinary,
      `#!/bin/sh\nexec ssh -i '${key}' -p ${readPort('22/tcp')} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR "$@"\n`,
    );

    await chmod(sshBinary, 0o755);

    await waitFor(
      () =>
        Bun.spawnSync([
          sshBinary,
          '-o',
          'BatchMode=yes',
          'shop@127.0.0.1',
          'pg_isready -h 127.0.0.1',
        ]).exitCode === 0
          ? true
          : null,
      { timeoutMs: 10_000 },
    );

    return {
      url: `postgres://shop:shop@127.0.0.1:${readPort('5432/tcp')}/shop`,
      sshBinary,
      destination: 'shop@127.0.0.1',
      containerID: id,
      remove,
    };
  } catch (error) {
    remove();
    throw error;
  }
}
