<div align="center">
  <h1>@wringer/browser</h1>

  <p>
    <a href="https://www.npmjs.com/package/@wringer/browser"><img src="https://img.shields.io/npm/v/@wringer/browser" alt="npm version"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  </p>
</div>

The browser driver for wringer: it drives a page of a target's app in a headless Chromium that the
run keeps open between commands.

## Install

```bash
bun add @wringer/core @wringer/browser
bunx playwright-core install chromium-headless-shell
```

The package runs on [Bun](https://bun.sh) 1.3 or newer. Pass `executablePath` to use a Chromium that
is already installed.

## Usage

```ts
import { browser } from '@wringer/browser';
import { createWringer, local } from '@wringer/core';

export const registry = createWringer({ name: 'shop' })
  .use(browser({ actionTimeoutMs: 10_000 }))
  .target('prod', {
    mode: 'attach',
    access: 'read-only',
    host: local(),
    endpoints: () => ({ web: 'https://shop.example' }),
    drivers: { browser: () => ({ readOnly: { allow: [{ role: 'button', name: 'Search' }] } }) },
  })
  .build();
```

An action calls `ctx.drivers.browser`, and the CLI adds the matching commands:

| Client call                | Command                                              | Effect |
| -------------------------- | ---------------------------------------------------- | ------ |
| `goto({ path })`           | `browser goto /cart`                                 | read   |
| `snapshot()`               | `browser snapshot`                                   | read   |
| `click({ ref })`           | `browser click --ref e5`                             | write  |
| `click({ role, name })`    | `browser click --role button --name Search`          | write  |
| `type({ ref, value })`     | `browser type --ref e4 --value buyer@shop.test`      | write  |
| `check(element)`           | `browser check --label "Gift wrap"`, `uncheck`       | write  |
| `press({ key, element })`  | `browser press Enter --label Email`                  | write  |
| `tabs()`, `tab({ index })` | `browser tabs`, `browser tab 1`, `browser tab close` | read   |
| `screenshot()`             | `browser screenshot`                                 | read   |

`click` names an element by `--ref`, by `--role` with `--name`, by `--label`, or by the `--text` it
shows, as [Browser locators](../../docs/reference/browser-locators.md) says. `check`, `uncheck`,
`hover` (a read) and `press` take the same flags. `press` takes a
[Playwright key](https://playwright.dev/docs/api/class-keyboard#keyboard-press) such as `Control+A`,
and with no element flag presses it on the focused element. `check` answers with the new `checked`
state, and a disabled control or a non-checkbox fails with a usage error. `goto --endpoint admin`
opens a path on an endpoint listed in `endpoints`, and an unlisted name is a usage error.

The doctor check `browser.launched` fails when the browser has closed. `browser.reachable` sends
HEAD to each endpoint, and GET after a 404, 405 or 501. It names the endpoint that cannot connect or
answers 5xx, and passes a redirect.

One second before a command's deadline, the driver closes the page under a running action, fails the
command, and opens a new page at the old URL. The command fails with a timeout, or, when its action
had already landed, with an environment error that points at `browser tabs`. A page that does not
close in half a second fails every later command until `up --restart`.

## Snapshots and refs

`snapshot` prints the page as an accessibility tree with a ref such as `[ref=e5]` on each element,
and keeps it as evidence. A ref acts on the last snapshot's element, so snapshot again after the
page changes. `screenshot` keeps a PNG. Both need a `goto` first.

`--until-text <text>` and `--until-no-text <text>` make `snapshot` poll every 250 ms until the page
has the first text and lacks the second (case-sensitive). When `actionTimeoutMs` runs out, or 2 s
before the command's deadline, it fails with `check-failed` and keeps the last snapshot as evidence.

## Tabs

`tabs` lists each tab's index, URL and title, and marks the active one. `tab <index>` switches to a
tab, and `tab close` closes the active tab and returns to its opener, but never the last tab. A
click or key press that opens a tab switches to it, and its result carries `openedTab`. A tab that
closes itself returns the driver to its opener, and the result carries `closedTab`. A switch forgets
the last snapshot's refs.

A click or key press that starts a download adds its `download` URL and file name to the result. The
driver closes the blank tab that the download opened, stays on the page, and keeps no file. Fetch
the file another way, such as with the http driver.

## Read-only targets

A read-only target refuses each click, type, check, uncheck and key press with exit code 3 and the
target's hint, unless its `readOnly.allow` lists the element's role and exact name. Name a granted
element by `--role` and `--name`, by `--label` with `--role`, or by `--text` with `--role`, because
the CLI cannot see a ref's role. A `press` with no element is always a write. A grant holds only
while the active tab is on the origin of the default endpoint or a listed one.
