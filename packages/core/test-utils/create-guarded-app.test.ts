import { expect, onTestFinished, test } from 'bun:test';
import { waitFor } from '@zgeoff/testing/helpers';
import invariant from 'tiny-invariant';
import { createGuardedApp } from './create-guarded-app.ts';

test('it starts an app that runs while its parent lives', async () => {
  const app = await createGuardedApp();

  onTestFinished(app.stop);

  const running = await app.probeRunning();

  expect(running).toBeTrue();
});

test('it reports the app as exited once it is stopped', async () => {
  const app = await createGuardedApp();

  onTestFinished(app.stop);

  await app.stop();

  const exited = await waitFor(async () => {
    const running = await app.probeRunning();

    invariant(!running, 'The app is still running.');

    return true;
  });

  expect(exited).toBeTrue();
});
