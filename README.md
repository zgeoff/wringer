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
checked. The agent runs each changed feature's journey through the repo's verify CLI, records a
verdict, and publishes a report into the PR description. CI runs the gate, which fails a PR whose
changed feature has no current verdict. The [terms](./docs/reference/terms.md) page defines journey,
verdict, gate and every other term the docs use. Each repo builds its verify CLI from the
`@wringer/*` packages, which this Bun workspace publishes to npm.

## A report

The report sits in the PR description under `## Verification`. This one covers a shop app:

<table>
<tr><th>Feature</th><th>Status</th><th>Target</th><th>Journey</th></tr>
<tr><td>checkout</td><td>verified</td><td>local</td><td>6 commands, 4 s</td></tr>
<tr><td>catalog</td><td>unchanged</td><td>-</td><td>-</td></tr>
</table>

Under that table, each verified feature has a collapsed journey table of its commands, results and
evidence.

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
- [`@wringer/terminal`](./packages/terminal/README.md): a text program, read from its screen.

## Add wringer to your repo

1. Install the packages, and zod, which the verify registry declares its schemas with:

   ```bash
   bun add --dev --exact @wringer/core @wringer/gunshi zod
   ```

2. Ask your coding agent to add a verify CLI to the repo by the guide that this command prints. The
   guide ships in `@wringer/gunshi`, so it matches the version you installed:

   ```bash
   bunx wringer-gunshi guide
   ```

   Expect: the `@wringer/gunshi` version and the list of topics.
   `bunx wringer-gunshi guide overview` prints where to start.

For more on the guide, see [Guide](./packages/gunshi/README.md#guide) in the gunshi README.

## Work on wringer

```bash
bun install
```

## Checks

```bash
bun run check
```

`bun run check` runs every check that CI runs, the browser tests included. `bun run test` leaves out
the `*.browser.test.ts` files, which `bun run test:browser` runs in a real headless Chromium.

On each pull request, CI runs the checks that the `BUN_CHECK_SCRIPTS` repo variable lists, and scans
the pull request's commits for secrets. A pull request that changes a package, the release scripts
or the release workflows also gets a dry run of the npm publish of each package.

## Layout

- `packages/`: the `@wringer/*` packages, one folder each. `packages/shop-example` never publishes:
  it holds an example shop app and the verify CLI for it. The browser tests drive the app through
  that CLI's registry with the `@wringer/http`, `db`, `stream`, `browser` and `terminal` packages,
  and `bun verify` runs the CLI.
- `packages/gunshi/guide/`: the guide that adds a verify CLI to a repo, with the template files it
  copies. It ships in `@wringer/gunshi`, and the CLI prints it with `guide`.
- `docs/`: the terms, the design docs and the runbooks.
- `scripts/`: the scripts the git hooks, CI and the release run.
- `packages/shop-example/verify-skill/`: the `verify-shop` skill that tells an agent how to drive
  the shop example with `bun run verify:shop`, with a feature file for each shop feature.
- `.claude/`: the agent skills that [zgeoff/tools](https://github.com/zgeoff/tools) syncs, and the
  hook that blocks an agent's edit until it loads the skill for that file.
