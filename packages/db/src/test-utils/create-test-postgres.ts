import {
  readRemainingMs,
  setupBudgetMs,
  waitUntilReady,
} from '@wringer/core/test-utils/wait-until-ready.ts';

export interface TestPostgres {
  readonly url: string;
  readonly containerID: string;
  readonly remove: () => void;
}

// A throwaway Postgres in Docker on a free local port, for the tests that need the real engine. Its
// image starts a temporary server without TCP first, so the probe asks over TCP. The whole setup
// keeps to one budget, and `signal` aborts when the test ends, so no probe outlives the test.
export async function createTestPostgres(signal: AbortSignal): Promise<TestPostgres> {
  const deadlineAtMs = Date.now() + setupBudgetMs;

  const started = Bun.spawnSync(
    [
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
    const published = Bun.spawnSync(['docker', 'port', id, '5432/tcp']).stdout.toString();
    const port = published.trim().split('\n')[0]?.split(':').at(-1) ?? '';

    await waitUntilReady(
      async (probeSignal) => {
        const ready = Bun.spawn(
          ['docker', 'exec', id, 'pg_isready', '-h', '127.0.0.1', '-U', 'shop'],
          { signal: probeSignal, stdout: 'ignore', stderr: 'ignore' },
        );

        return (await ready.exited) === 0;
      },
      { label: 'Postgres', deadlineAtMs, signal },
    );

    signal.removeEventListener('abort', remove);

    return { url: `postgres://shop:shop@127.0.0.1:${port}/shop`, containerID: id, remove };
  } catch (error) {
    signal.removeEventListener('abort', remove);

    remove();
    throw error;
  }
}
