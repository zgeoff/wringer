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

## Features

- The envelope's zod schema, and the JSON Schema built from it.
- A closed set of error codes, each mapped to one exit code.
- Run state on disk: `state.json` holds pointers, and each run's `log.ndjson` holds its events.
- The fingerprint: `git patch-id --stable` of the working tree against the merge base, which stays
  the same across a commit and a clean rebase. Every git setting that shapes the diff is pinned, so
  the same change gets the same fingerprint in any clone.
- Two hosts for exec: `local()`, and `ssh()` with an argv prefix in layers, quoted once per shell
  layer.

## Error codes

An envelope's `error.code` is one of these, and the command exits with its exit code:

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

A command that passes exits `0`.
