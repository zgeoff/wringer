import { expect, test } from 'bun:test';
import { makeInstallHintLauncher } from './make-install-hint-launcher.ts';

function setupTest() {
  return { wrap: makeInstallHintLauncher };
}

test('it gives a missing browser an environment error with the documented install command', () => {
  const ctx = setupTest();

  const launch = ctx.wrap(() =>
    Promise.reject(
      new Error(
        "browserType.launch: Executable doesn't exist at /cache/chrome-headless-shell\nRun: npx playwright install",
      ),
    ),
  );

  expect(launch()).rejects.toMatchObject({
    code: 'environment',
    hint: 'bunx playwright-core install chromium-headless-shell',
  });

  expect(launch()).rejects.not.toThrow('npx playwright install');
});

test('it keeps the message of any other launch failure', () => {
  const ctx = setupTest();

  const launch = ctx.wrap(() =>
    Promise.reject(
      new Error('browserType.launch: Target page, context or browser has been closed'),
    ),
  );

  expect(launch()).rejects.toThrowWithMessage(
    Error,
    'browserType.launch: Target page, context or browser has been closed',
  );
});
