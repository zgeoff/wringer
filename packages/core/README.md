<div align="center">
  <h1>@wringer/core</h1>

  <p>
    <a href="https://www.npmjs.com/package/@wringer/core"><img src="https://img.shields.io/npm/v/@wringer/core" alt="npm version"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  </p>
</div>

The core of wringer, a verification framework that each repo wraps in its own CLI.

Every wringer command writes one JSON envelope. The package exports the envelope's version number,
which a consumer checks before it reads the rest of the envelope.

## Install

```bash
bun add @wringer/core
```

The package runs on [Bun](https://bun.sh) 1.3 or newer.
