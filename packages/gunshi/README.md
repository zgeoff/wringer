<div align="center">
  <h1>@wringer/gunshi</h1>

  <p>
    <a href="https://www.npmjs.com/package/@wringer/gunshi"><img src="https://img.shields.io/npm/v/@wringer/gunshi" alt="npm version"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  </p>
</div>

Turns a wringer registry into the repo's verify CLI, with [gunshi](https://gunshi.dev) parsing the
command line.

## Install

```bash
bun add @wringer/core @wringer/gunshi
```

The package runs on [Bun](https://bun.sh) 1.3 or newer.

## Usage

Call `runVerify` from the repo's verify script with the registry that `@wringer/core` builds:

```ts
import { runVerify } from '@wringer/gunshi';
import { registry } from './registry.ts';

await runVerify(registry);
```

Run it as `bun verify.ts <command>`, for example `bun verify.ts up` or
`bun verify.ts action seed --count 3`.

## Behaviour

- Each command prints one JSON envelope. A streaming command, such as `doctor`, prints its NDJSON
  events first.
- The CLI prints text in place of JSON when stdout is a terminal and no coding agent runs it.
  `--human` and `--json` choose the format.
- An unknown flag, a flag of the wrong type or arguments that fail the command's schema end in a
  `usage` envelope and exit code 2.
- Every command takes `--target`, `--feature` and `--timeout-ms`, unless it declares an argument of
  the same name. `use --target` sets the target for later commands, where `status --target` reads
  one target once.
- `--help` marks each command `[read]` or `[write]`, so a reader sees which commands a read-only
  target refuses.
- The script starts itself again, detached, as the run's supervisor, so `up` and `attach` need no
  separate daemon.
