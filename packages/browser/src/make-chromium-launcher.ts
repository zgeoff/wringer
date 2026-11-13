import type { Browser, LaunchOptions } from 'playwright-core';
import { makeInstallHintLauncher } from './make-install-hint-launcher.ts';

export type LaunchChromium = (options: LaunchOptions) => Promise<Browser>;

// A user who sets `executablePath` chose the browser, so the install command does not apply.
export function makeChromiumLauncher(
  launchChromium: LaunchChromium,
  executablePath: string | undefined,
): () => Promise<Browser> {
  if (executablePath === undefined) {
    return makeInstallHintLauncher(() => launchChromium({ headless: true }));
  }

  return () => launchChromium({ headless: true, executablePath });
}
