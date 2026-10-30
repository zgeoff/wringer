<div align="center">
  <h1>wringer</h1>

  <p>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
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

CI runs the same checks on each pull request, and scans each pull request's commits for secrets.

## Layout

- `packages/`: the `@wringer/*` packages, one folder each.
- `scripts/`: the scripts the git hooks and CI run.
- `.claude/`: the shared agent skills and the skill-gate hook.
