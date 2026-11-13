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
The package publishes the envelope's JSON Schema as `@wringer/core/envelope.schema.json`.

## Install

```bash
bun add @wringer/core
```

The package runs on [Bun](https://bun.sh) 1.3 or newer.

## Usage

A repo builds its registry with the typed builder, then hands it to a CLI adapter:

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

Add drivers with `.use(...)`. `bindDrivers(drivers)` returns `defineAction`, `defineTarget`,
`defineCommand` and `defineCheck`, typed against those drivers, so a repo can define each one in its
own file.

## Features

- The typed builder. Each action and command declares `effect: 'read' | 'write'`, and is a write
  unless it says otherwise.
- Read-only targets: each driver client and exec refuses a write there with `read-only` and the
  target's hint. A target's driver config lists the writes it grants.
- One supervisor process per run, which owns the app and every driver service.
- The built-in commands, from `up` and `doctor` to `done`, `report` and `gate`. `done` records the
  fingerprint of the diff limited to the feature's `paths` and the registry's `.shared()` globs, so
  an edit to another feature's files leaves the verdict standing. `gate` fails a PR when a changed
  feature lacks a verdict at its own current fingerprint, and when a changed path matches neither a
  feature's `paths` nor an `.ignore` glob. `report` lists those unmapped paths.
- The ignore list: `.ignore(...globs)` names the paths with no runtime effect, such as docs and
  tests. Any path an ignore glob matches counts as no change, even when a feature's `paths` match it
  too. The gate skips it and the fingerprint leaves it out, so a README edit keeps each verdict
  fresh. Feature `paths` and ignore globs both match with `Bun.Glob`.
- The envelope's zod schema, and the JSON Schema built from it.
- A closed set of error codes, each mapped to one exit code.
- Run state on disk: `state.json` holds pointers, and each run's `log.ndjson` holds its events.
- The fingerprint: `git patch-id --verbatim` of the working tree against the merge base, less the
  state folder and the ignored paths, which stays the same across a commit and across a clean rebase
  that leaves the 3 lines around each change as they were. A rebase that changes those lines changes
  the fingerprint, because the hash keeps the diff's context. It needs git 2.39 or later. Only the
  tracked files and git's defaults shape it: the config, attributes and ignore files of the clone,
  the user and the system never apply, so the same change gets the same fingerprint in any clone. A
  clone whose config converts a file as git adds it, such as `core.autocrlf` or a clean filter, can
  get another fingerprint once the change is committed; the verdict then reads as stale, never as
  fresh. A sparse checkout, a linked worktree, a shallow or partial clone and a detached HEAD get
  the fingerprint of the same change in a full clone, and a file on disk that the index marks
  skip-worktree counts as any other. A repo with no commit, a shallow clone that lacks the merge
  base, and a submodule that holds work it has not committed fail with an `environment` error.
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
| `not-running`        | 3    | The target has no running run.                 |
| `target-not-allowed` | 3    | The command does not run on this target.       |
| `environment`        | 4    | A tool, a host or the network failed.          |
| `internal`           | 4    | wringer failed; the stack is in the run's log. |
| `timeout`            | 5    | The command ran past its deadline.             |
