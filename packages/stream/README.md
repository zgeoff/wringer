<div align="center">
  <h1>@wringer/stream</h1>

  <p>
    <a href="https://www.npmjs.com/package/@wringer/stream"><img src="https://img.shields.io/npm/v/@wringer/stream" alt="npm version"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  </p>
</div>

The stream driver for wringer: it records a target's logs for the whole run, and reads them back
from a cursor.

## Install

```bash
bun add @wringer/core @wringer/stream
```

The package runs on [Bun](https://bun.sh) 1.3 or newer.

## Usage

```ts
import { createWringer, ssh } from '@wringer/core';
import { stream } from '@wringer/stream';

export const registry = createWringer({ name: 'shop' })
  .use(stream({}))
  .target('staging', {
    mode: 'attach',
    access: 'read-only',
    host: ssh({ destination: 'deploy@staging.shop.example' }),
    drivers: {
      stream: () => ({
        sources: { jobs: { command: ['journalctl', '-f', '-u', 'shop-jobs', '-o', 'cat'] } },
      }),
    },
  })
  .build();
```

An action calls `ctx.drivers.stream.read({ name, from })`. The CLI adds `stream read <name>`, and
the doctor check `stream.recording`, which fails when a source has stopped or its records fail to
write.

## Sources

- `{ command: [...] }` runs the command on the target's host and records each line it prints. At the
  stop, the recorder reads on until the command prints nothing for 200 ms, for at most 2 s, then
  kills it.
- `{ file: '<path>' }` follows a file on the machine where the run lives. The supervisor stops the
  app first, then reads the file to its end, so the lines the app logs while it shuts down are
  recorded.
- On an `attach` target, the run owns no app, so the recorder stops without waiting for one. A line
  the app writes after the recorder's final read stays out of the stream.
- A target with no `sources` records `app`: the log of the app that the run launched.

The run's supervisor writes each source to `streams/<name>.ndjson` in the run folder, one
`{ at, line }` record per line. A record keeps at most 4096 characters of its line. When a source
logs faster than the disk takes it, the supervisor holds at most 10,000 pending records per source,
plus the batch it is writing. It drops the rest, and then writes a record that counts the dropped
lines. A batch that fails to write stays queued for the next write, and the source reads as failed
until a write succeeds. When the run stops with records still unwritten, or with a source it could
not read, the run ends as crashed, and its crash reason names the stream and the error. The `down`
or `detach` that stopped the run then fails with an `environment` error that names them too.

## Cursors

A cursor is a byte offset into a stream's file. `use` marks the end of each stream, and every
envelope holds the current ends in `cursors`.

- A read with no `from` starts at the cursor that `use` last marked, so it returns only what was
  logged since.
- A read returns the records up to the `maxBytes` option, 64 KiB by default, with the next `cursor`
  and `more` when the stream holds more. A read may pass a smaller `maxBytes`, down to 32 KiB.
- A cursor past the end of the file belongs to an older run, so the read starts over at 0.
