<div align="center">
  <h1>wringer</h1>

  <p>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  </p>

  <p>
    <a href="./docs/README.md">Documentation</a>
  </p>
</div>

A verification framework that each repo wraps in its own CLI.

wringer gives a coding agent one way to drive a repo's real app and keep the evidence of what it
checked. Each repo builds its own verify CLI from the `@wringer/*` packages, which this Bun
workspace publishes to npm.

## Packages

- [`@wringer/core`](./packages/core/README.md): the typed registry, the JSON envelope, the error
  codes, read-only targets, the run supervisor, the run state and the fingerprint.
- [`@wringer/gunshi`](./packages/gunshi/README.md): turns a registry into the repo's verify CLI.
- [`@wringer/http`](./packages/http/README.md): requests to the target's app.
- [`@wringer/db`](./packages/db/README.md): SQL on the target's SQLite or Postgres database.
- [`@wringer/stream`](./packages/stream/README.md): the target's logs, recorded for the run and read
  from a cursor.
- [`@wringer/browser`](./packages/browser/README.md): a page of the target's app in a headless
  browser.

## Add wringer to your repo

1. Install the packages, and zod, which the verify registry declares its schemas with:

   ```bash
   bun add --dev --exact @wringer/core @wringer/gunshi zod
   ```

2. Ask your coding agent to read the guide and add a verify CLI to the repo. The guide ships in the
   package, so it matches the version you installed:

   ```bash
   bunx wringer-gunshi guide
   ```

   Expect: the version and the list of topics. `bunx wringer-gunshi guide overview` prints where to
   start.

The gunshi README's [Guide](./packages/gunshi/README.md#guide) section says more.

## Work on wringer

```bash
bun install
```

## Checks

```bash
bun run check
```

`bun run test` leaves out the browser lane, the `*.browser.test.ts` files, which
`bun run test:browser` runs against a real headless Chromium.

CI runs the checks that the `BUN_CHECK_SCRIPTS` repo variable lists on each pull request, and scans
its commits for secrets. A pull request that changes a package or the publish path also gets a
rehearsal of the npm publish of each package.

## Layout

- `packages/`: the `@wringer/*` packages, one folder each. `packages/shop-example` never publishes:
  it holds an example shop app and the verify CLI for it. The browser tests drive the app through
  that CLI's registry with the `@wringer/http`, `db`, `stream` and `browser` packages, and
  `bun verify` runs the CLI.
- `packages/gunshi/guide/`: the guide that adds a verify CLI to a repo, with the template files it
  copies. It ships in `@wringer/gunshi`, and the CLI prints it with `guide`.
- `docs/`: the runbooks.
- `scripts/`: the scripts the git hooks, CI and the release run.
- `.claude/`: the agent skills that zgeoff/tools syncs, the hook that blocks an agent's edit until
  it loads the skill for that file, and `verify-shop`, the skill that tells an agent how to drive
  the shop example with `bun verify`.

## Documentation

The [docs index](./docs/README.md) lists the runbooks.
