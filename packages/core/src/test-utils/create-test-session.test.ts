import { expect, onTestFinished, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { createShopWringer } from './create-shop-wringer.ts';
import { createTestSession } from './create-test-session.ts';
import { removeTestFolder } from './remove-test-folder.ts';

test('it starts a run whose supervisor runs in the test process', async () => {
  const wringer = createShopWringer();

  const shop = await createTestSession({ parent: import.meta.dir, wringer });
  const result = await shop.dispatch(wringer, ['up'], {}, { ...shop.session, target: 'local' });

  expect({ exitCode: result.exitCode, ok: result.envelope.ok }).toStrictEqual({
    exitCode: 0,
    ok: true,
  });
});

// `echo-late` answers at its 50 ms deadline and writes its late failure 300 ms later, so a cleanup
// that removes the repo at once lets that write create the repo's folder again.
test('it removes the repo only after the late work of a command that timed out has ended', async () => {
  const wringer = createShopWringer();

  const shop = await createTestSession({ parent: import.meta.dir, wringer });
  const result = await shop.dispatch(wringer, ['echo-late'], { text: 'a receipt' }, shop.session);

  // Registered after the session's cleanup, so it runs once that cleanup has ended.
  onTestFinished(async () => {
    await result.late;

    const kept = existsSync(shop.repo.root);

    await removeTestFolder(shop.repo.root);

    expect(kept).toBe(false);
  });

  expect(result.envelope.error?.code).toBe('timeout');
});
