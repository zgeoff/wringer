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

- [`@wringer/core`](./packages/core/README.md): the version of the JSON envelope that every wringer
  command writes.

## Quick start

```bash
bun install
```

## Checks

```bash
bun run check
```

CI runs the same checks on each pull request and scans its commits for secrets. A pull request that
changes a package or the publish path also gets a rehearsal of the npm publish of each package.

## Layout

- `packages/`: the `@wringer/*` packages, one folder each.
- `docs/`: the runbooks.
- `scripts/`: the scripts the git hooks, CI and the release run.
- `.claude/`: the shared agent skills and the skill-gate hook.

## Documentation

The [docs index](./docs/README.md) lists the runbooks.
