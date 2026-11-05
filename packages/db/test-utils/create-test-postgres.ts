import { waitFor } from '../../core/test-utils/wait-for.ts';

export interface TestPostgres {
  readonly url: string;
  readonly containerID: string;
  readonly remove: () => void;
}

// A throwaway Postgres in Docker on a free local port, for the tests that need the real engine. Its
// image starts a temporary server without TCP first, so the probe asks over TCP.
export async function createTestPostgres(): Promise<TestPostgres> {
  const started = Bun.spawnSync([
    'docker',
    'run',
    '--detach',
    '--rm',
    '--env',
    'POSTGRES_USER=shop',
    '--env',
    'POSTGRES_PASSWORD=shop',
    '--publish',
    '127.0.0.1::5432',
    'postgres:17-alpine',
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
    const published = Bun.spawnSync(['docker', 'port', id, '5432/tcp']).stdout.toString();
    const port = published.trim().split('\n')[0]?.split(':').at(-1) ?? '';

    await waitFor(
      () =>
        Bun.spawnSync(['docker', 'exec', id, 'pg_isready', '-h', '127.0.0.1', '-U', 'shop'])
          .exitCode === 0
          ? true
          : null,
      { timeoutMs: 10_000 },
    );

    return { url: `postgres://shop:shop@127.0.0.1:${port}/shop`, containerID: id, remove };
  } catch (error) {
    remove();
    throw error;
  }
}
