import { WringerError } from '@wringer/core';
import type { Browser } from 'playwright-core';

const missingBrowserText = "Executable doesn't exist";

// playwright-core's own message tells the user to run `npx playwright install`, a command for a
// package this driver does not use, so a missing browser gets the install command that the
// package README gives.
export function makeInstallHintLauncher(
  launchBrowser: () => Promise<Browser>,
): () => Promise<Browser> {
  return async () => {
    try {
      return await launchBrowser();
    } catch (error) {
      if (error instanceof Error && error.message.includes(missingBrowserText)) {
        throw new WringerError('environment', {
          message: 'The browser that the driver needs is not installed.',
          hint: 'bunx playwright-core install chromium-headless-shell',
        });
      }

      throw error;
    }
  };
}
