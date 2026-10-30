<div align="center">
  <h1>wringer</h1>

  <p>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  </p>
</div>

A verification framework that each repo wraps in its own CLI.

wringer gives a coding agent one way to drive a repo's real app and keep the evidence of what it checked. Each repo builds its own verify CLI from the `@wringer/*` packages, which this Bun workspace publishes to npm.

## Quick start

```bash
bun install
```
