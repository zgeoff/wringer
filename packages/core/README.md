<div align="center">
  <h1>@wringer/core</h1>

  <p>
    <a href="https://www.npmjs.com/package/@wringer/core"><img src="https://img.shields.io/npm/v/@wringer/core" alt="npm version"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  </p>
</div>

The core of wringer, a verification framework that each repo wraps in its own CLI.

Every wringer command writes one JSON envelope, and a streaming command writes NDJSON events before
it. The envelope carries `wringer: 1`, so a consumer checks the version before it reads the rest.
Core exports the envelope's zod schema, and its JSON Schema as `@wringer/core/envelope.schema.json`.

## Install

```bash
bun add @wringer/core
```

The package runs on [Bun](https://bun.sh) 1.3 or newer.

## Usage

A repo builds its [registry](../../docs/reference/terms.md#registry) with the typed builder, then
hands it to a CLI adapter such as [`@wringer/gunshi`](../gunshi/README.md):

```ts
import { createWringer, local } from '@wringer/core';

export const registry = createWringer({ name: 'shop' })
  .target('local', {
    mode: 'launch',
    access: 'read-write',
    host: local(),
    launch: () => ({
      command: ['bun', 'run', 'dev'],
      ready: (line) => (line['event'] === 'listening' ? { web: 'http://127.0.0.1:3000' } : null),
    }),
  })
  .feature({ name: 'checkout', summary: 'Pay for the cart', paths: ['src/checkout/**'] })
  .ignore('docs/**', '**/*.md', '**/*.test.ts')
  .build();
```

Add [drivers](../../docs/reference/terms.md#driver) with `.use(...)`. `bindDrivers(drivers)` returns
`defineAction`, `defineTarget`, `defineCommand` and `defineCheck`, typed against those drivers, so a
repo can define each one in its own file.

## Features

- The typed builder. Each action and command takes `effect: 'read' | 'write'`, which defaults to
  `write`.
- Read-only targets: each driver client and exec refuses a write there with `read-only` and the
  target's hint. A target's driver config lists the writes it grants.
- One supervisor process per run, which owns the app and every driver service.
- The built-in commands, such as `up`, `doctor`, `done`, `report` and `gate`. `done` records a
  [verdict](../../docs/reference/terms.md#verdict) at the feature's
  [fingerprint](../../docs/reference/terms.md#fingerprint), so an edit to another feature's files
  leaves the verdict standing. For the git version a fingerprint needs, and when it changes or
  fails, see the [Verdict scope constraints](../../docs/design/verdict-scope.md#constraints).
  `report` lists each path changed since the merge base with the base branch that no feature, shared
  glob or ignore glob matches.
- The [gate](../../docs/reference/terms.md#gate), and its policy:
  `.gate({ unpinned: 'allow' | 'refuse' })` sets whether `gate` accepts a verdict on an
  [attach target](../../docs/reference/terms.md#target) that reports no commit. The default is
  `allow`; `refuse` fails the gate on such a verdict.
- The [ignore list](../../docs/reference/terms.md#ignore-list): `.ignore(...globs)`. Any path an
  ignore glob matches counts as no change, even when a feature's `paths` match it too. Feature
  `paths` and ignore globs both match with `Bun.Glob`.
- The [shared globs](../../docs/reference/terms.md#shared-glob): `.shared(...globs)`. A change to a
  path one matches changes every feature's fingerprint.
- Secret scrubbing: `.secret(...envNames)` names the environment variables that hold the repo's
  secrets. Core replaces every known secret with `[redacted:<name>]` in evidence, the envelope and
  the run log, and checks each file again before `report` uploads it.
- Run state on disk: `state.json` holds pointers, and each run's `log.ndjson` holds its events.
- Two hosts for exec: `local()`, and `ssh()` with an argv prefix in layers, quoted once per shell
  layer. Each host also follows a long-running command, such as `tail -F`, line by line.

## Error codes

A command that passes exits `0`. A command that fails puts one of these in the envelope's
`error.code`, and exits with its exit code:

| Code                 | Exit | Meaning                                        |
| -------------------- | ---- | ---------------------------------------------- |
| `check-failed`       | 1    | A check or an assertion failed.                |
| `usage`              | 2    | The command or its arguments are not valid.    |
| `read-only`          | 3    | A read-only target refused a write.            |
| `doctor-required`    | 3    | The doctor has not passed on the current run.  |
| `not-running`        | 3    | The target has no run in progress.             |
| `target-not-allowed` | 3    | The command does not run on this target.       |
| `environment`        | 4    | A tool, a host or the network failed.          |
| `internal`           | 4    | wringer failed; the stack is in the run's log. |
| `timeout`            | 5    | The command ran past its deadline.             |
