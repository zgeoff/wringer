import { expect, onTestFinished, test } from 'bun:test';
import { createGuardedApp } from './create-guarded-app.ts';
import { waitFor } from './wait-for.ts';

test('it starts an app that runs while its parent lives', async () => {
  const app = await createGuardedApp();

  onTestFinished(app.stop);

  const running = await app.probeRunning();

  expect(running).toBeTrue();
});

test('it reports the app as exited once it is stopped', async () => {
  const app = await createGuardedApp();

  await app.stop();

  const exited = await waitFor(async () => {
    const running = await app.probeRunning();

    return running ? null : true;
  });

  expect(exited).toBeTrue();
});
