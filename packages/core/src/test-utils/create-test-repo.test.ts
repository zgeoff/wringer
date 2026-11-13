import { expect, onTestFinished, test } from 'bun:test';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestRepo } from './create-test-repo.ts';

test('it creates a repo on main with one commit that ignores the state folder', async () => {
  const repo = await createTestRepo(import.meta.dir);

  onTestFinished(() => repo.remove());

  const [branch, commits, ignored] = await Promise.all([
    repo.git('branch', '--show-current'),
    repo.git('rev-list', '--count', 'HEAD'),
    repo.git('check-ignore', '.wringer/runs'),
  ]);

  expect({ branch, commits, ignored }).toStrictEqual({
    branch: 'main\n',
    commits: '1\n',
    ignored: '.wringer/runs\n',
  });
});

test('it removes the repo while late work keeps adding files under the state folder', async () => {
  const repo = await createTestRepo(import.meta.dir);

  const started = Promise.withResolvers<void>();

  onTestFinished(() => repo.remove());

  const lanes = [0, 1, 2, 3];

  await Promise.all(
    lanes.map((lane) => mkdir(join(repo.root, '.wringer', `lane-${lane}`), { recursive: true })),
  );

  // Each folder is made without `recursive`, so a write that fails once the removal has taken its
  // parent is late work losing the race, and nothing recreates the repo after the removal.
  const keepWriting = async (lane: number): Promise<void> => {
    for (let index = 0; index < 400; index += 1) {
      const folder = join(repo.root, '.wringer', `lane-${lane}`, `run-${index}`);

      const [made] = await Promise.allSettled([mkdir(folder)]);

      await Promise.allSettled([
        made.status === 'fulfilled' ? writeFile(join(folder, 'late'), 'late') : null,
      ]);

      started.resolve();
    }
  };

  const writers = lanes.map((lane) => keepWriting(lane));

  await started.promise;

  const removal = repo.remove();

  await Promise.all(writers);

  await expect(removal).toResolve();
  await expect(access(repo.root)).toReject();
});
