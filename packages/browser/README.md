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

| Client call             | Command                                         | Effect |
| ----------------------- | ----------------------------------------------- | ------ |
| `goto({ path })`        | `browser goto /cart`                            | read   |
| `snapshot()`            | `browser snapshot`                              | read   |
| `describe({ ref })`     | none                                            | read   |
| `click({ ref })`        | `browser click --ref e5`                        | write  |
| `click({ role, name })` | `browser click --role button --name Search`     | write  |
| `type({ ref, value })`  | `browser type --ref e4 --value buyer@shop.test` | write  |
| `screenshot()`          | `browser screenshot`                            | read   |

The doctor check `browser.launched` fails when the browser has closed.

When a command's deadline passes during a browser action, the driver closes the page under the
action, so a late click never lands. The next command finds a new page at the same URL, without the
input the old page held.

## Snapshots and refs

`snapshot` prints the page as an accessibility tree, with a ref such as `[ref=e5]` on each element,
and keeps it as evidence. A click or a type by ref acts on the element of the last snapshot, so take
a snapshot after the page changes. `screenshot` keeps a PNG of the whole page as evidence.

## Read-only targets

A read-only target refuses each click and type with exit code 3 and the target's hint, unless its
`readOnly.allow` lists the element's role and exact name. The CLI cannot see a ref's role before it
runs, so name a granted element by `--role` and `--name` on a read-only target.
