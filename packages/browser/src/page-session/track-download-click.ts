import type { Page } from 'playwright-core';

const CLICK_FLAG = '__wringerClickedDownloadLink';

// The package has no DOM types, so the listener that runs in the page is source text. It notes a
// click on a link with a download attribute, which the browser turns into a download with no
// request, navigation or other event that the driver can see before the download arrives.
const ARM_SOURCE = `(() => {
  window.${CLICK_FLAG} = false;

  if (window.${CLICK_FLAG}Armed) {
    return;
  }

  window.${CLICK_FLAG}Armed = true;

  document.addEventListener(
    'click',
    (event) => {
      if (event.composedPath().some((node) => node.localName === 'a' && node.hasAttribute('download'))) {
        window.${CLICK_FLAG} = true;
      }
    },
    true,
  );
})()`;

// Clears the note of a click on a download link, and listens for the next one. The function it
// returns answers whether a click on a download link came since. A page that has navigated away lost
// its note, and its download, if any, started with a request.
export async function trackDownloadClick(page: Page): Promise<() => Promise<boolean>> {
  try {
    await page.evaluate(ARM_SOURCE);
  } catch {
    // A page that cannot run script has no link to note.
  }

  return async () => {
    try {
      return (await page.evaluate(`window.${CLICK_FLAG} === true`)) === true;
    } catch {
      return false;
    }
  };
}
