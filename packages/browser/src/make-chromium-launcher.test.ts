import { expect, test } from 'bun:test';
import { WringerError } from '@wringer/core';
import { makeChromiumLauncher } from './make-chromium-launcher.ts';

function setupTest() {
  return {
    launchChromium: () =>
      Promise.reject(new Error("browserType.launch: Executable doesn't exist at /cache/chrome")),
  };
}

test('it keeps the original launch error when the chosen executable does not exist', () => {
  const ctx = setupTest();
  const launch = makeChromiumLauncher(ctx.launchChromium, '/opt/my-chrome');

  expect(launch()).rejects.toThrowWithMessage(
    Error,
    /Executable doesn't exist at \/cache\/chrome/u,
  );

  expect(launch()).rejects.not.toBeInstanceOf(WringerError);
});

test('it gives the install hint when no executable is chosen and the browser is missing', () => {
  const ctx = setupTest();
  const launch = makeChromiumLauncher(ctx.launchChromium, undefined);

  expect(launch()).rejects.toBeInstanceOf(WringerError);
});
