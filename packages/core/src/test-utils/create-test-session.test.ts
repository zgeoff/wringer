import { expect, test } from 'bun:test';
import { dispatch } from '../dispatch.ts';
import { createShopWringer } from './create-shop-wringer.ts';
import { createTestSession } from './create-test-session.ts';

test('it starts a run whose supervisor runs in the test process', async () => {
  const wringer = createShopWringer();

  const shop = await createTestSession({ parent: import.meta.dir, wringer });
  const result = await dispatch(wringer, ['up'], {}, { ...shop.session, target: 'local' });

  expect({ exitCode: result.exitCode, ok: result.envelope.ok }).toStrictEqual({
    exitCode: 0,
    ok: true,
  });
});
