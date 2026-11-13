import { chmod, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DockerImage } from './create-docker-image.ts';
import { createDockerImage } from './create-docker-image.ts';
import { readRemainingMs, setupBudgetMs, waitUntilReady } from './wait-until-ready.ts';

export interface TestSSHPostgres {
  readonly url: string;
  readonly sshBinary: string;
  readonly destination: string;
  readonly containerID: string;
  readonly remove: () => void;
}

// Postgres with sshd beside it, so psql runs on the "remote" host the way a `via: 'exec'` target
// over ssh runs it. psql reaches the database over its local socket, which the image trusts.
export const testSSHPostgresImage: DockerImage = {
  tag: 'wringer-test-ssh-postgres:2',
  dockerfile: `FROM postgres:17-alpine
RUN apk add --no-cache openssh && ssh-keygen -A && adduser -D -h /srv/shop shop && passwd -u shop
CMD ["sh", "-c", "mkdir -p /srv/shop/.ssh && cp /run/key.pub /srv/shop/.ssh/authorized_keys && chown -R shop /srv/shop/.ssh && /usr/sbin/sshd && exec docker-entrypoint.sh postgres"]
`,
};

// `directory` holds the key pair and an ssh wrapper that passes the key and the port, so the
// caller's ssh host needs only `binary` and `destination`. `signal` aborts when the test ends, so
// no probe outlives the cleanup that removes `directory`. The budget leaves out the image build.
export async function createTestSSHPostgres(
  directory: string,
  signal: AbortSignal,
): Promise<TestSSHPostgres> {
  await createDockerImage(testSSHPostgresImage);

  // The abort listener below never fires for a signal that aborted during the build.
  if (signal.aborted) {
    throw new Error('Postgres over ssh was not ready before the test ended');
  }

  const deadlineAtMs = Date.now() + setupBudgetMs;
  const key = join(directory, 'key');

  Bun.spawnSync(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-f', key]);

  const started = Bun.spawnSync(
    [
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
      testSSHPostgresImage.tag,
    ],
    { timeout: readRemainingMs(deadlineAtMs, 'docker run') },
  );

  if (started.exitCode !== 0) {
    const reason =
      started.exitedDueToTimeout === true
        ? 'ran past the setup budget'
        : `failed: ${started.stderr.toString()}`;

    throw new Error(`docker run ${reason}`);
  }

  const id = started.stdout.toString().trim();

  const remove = (): void => {
    // A forced removal keeps the image's anonymous data volume unless it names `--volumes`.
    Bun.spawnSync(['docker', 'rm', '--force', '--volumes', id]);
  };

  // The caller holds `remove` only once this returns, and bun can exit right after a test that
  // times out, so a test that ends during setup removes the container in its own cleanup.
  signal.addEventListener('abort', remove, { once: true });

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

    await waitUntilReady(
      async (probeSignal) => {
        const ready = Bun.spawn(
          [sshBinary, '-o', 'BatchMode=yes', 'shop@127.0.0.1', 'pg_isready -h 127.0.0.1'],
          { signal: probeSignal, stdout: 'ignore', stderr: 'ignore' },
        );

        return (await ready.exited) === 0;
      },
      { label: 'Postgres over ssh', deadlineAtMs, signal },
    );

    signal.removeEventListener('abort', remove);

    return {
      url: `postgres://shop:shop@127.0.0.1:${readPort('5432/tcp')}/shop`,
      sshBinary,
      destination: 'shop@127.0.0.1',
      containerID: id,
      remove,
    };
  } catch (error) {
    signal.removeEventListener('abort', remove);

    remove();
    throw error;
  }
}
