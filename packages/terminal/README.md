<div align="center">
  <h1>@wringer/terminal</h1>

  <p>
    <a href="https://www.npmjs.com/package/@wringer/terminal"><img src="https://img.shields.io/npm/v/@wringer/terminal" alt="npm version"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  </p>
</div>

The terminal driver for wringer: it runs a target's text programs in a pseudo-terminal that the run
keeps open, sends them keys, and reads their screen.

## Install

```bash
bun add @wringer/core @wringer/terminal
```

The package runs on [Bun](https://bun.sh) 1.4 or newer, which provides the pseudo-terminal.

## Usage

```ts
import { createWringer, local } from '@wringer/core';
import { terminal } from '@wringer/terminal';

export const registry = createWringer({ name: 'shop' })
  .use(terminal({ cols: 120, rows: 40 }))
  .target('local', {
    mode: 'attach',
    access: 'read-write',
    host: local(),
    drivers: {
      terminal: ({ run }) => ({
        programs: {
          tui: {
            command: ['bun', 'src/cli.ts', 'tui'],
            env: { SHOP_HOME: run.paths.directory },
            cwd: '.',
          },
        },
      }),
    },
  })
  .build();
```

`cols` and `rows` default to 120 and 40. The target names each program an agent may start, so an
agent never passes a command line. A program's `cwd` starts at the folder where the run's supervisor
runs, which is the repo root, and its `env` adds to the supervisor's environment. The programs run
on the machine where the run lives, so use the driver with a `local()` host.

## Commands

| Command                                     | Effect | Answer                            |
| ------------------------------------------- | ------ | --------------------------------- |
| `terminal start <program>`                  | write  | `{ session, pid }`                |
| `terminal type --text <text>`               | write  | types the text as key events      |
| `terminal type --secret-env <NAME>`         | write  | types the value of `$NAME`        |
| `terminal press <key>...`                   | write  | presses each key in order         |
| `terminal wait --text <t>` or `--regex <r>` | read   | `{ match: { row, col }, screen }` |
| `terminal screen`                           | read   | `{ text, cursor, cols, rows }`    |
| `terminal stop`                             | write  | `{ exitCode }`                    |
| `terminal list`                             | read   | the sessions of the run           |

Every command except `start` and `list` takes `--session <id>`. It is optional while one session
runs, and required while more than one runs. Sessions are named `<program>-<n>`, such as `tui-1`.

- Rows and columns count from 0. `col` counts characters of the line. A `match` counts the screen's
  rows, and `screen.text` joins the rows a program wrapped into one line, so a secret that wrapped
  is still redacted. Its line numbers differ from the rows after a wrap.
- A key is a name such as `enter`, `esc`, `tab`, `up`, `f5`, `ctrl+c` or `alt+x`. The driver turns
  it into the bytes that the program's current modes expect, so `ctrl+c` is `\x03` for a plain
  program and `\x1b[99;5u` after the program turns on the kitty keyboard protocol.
- `wait` checks the screen after each chunk of output. It fails with `check-failed` when nothing
  matches within `--timeout-ms` (10 s by default), and keeps the last screen as evidence.
- `screen` and a failed `wait` write `screen.txt` as evidence. The raw bytes of each session go to
  `children/terminal-<session>.log` in the run folder, outside the evidence that a run uploads.

## Secrets

`type --secret-env <NAME>` reads the variable from the environment of the command, and adds its
value to the command's secrets before it sends a key. The value is then redacted from the envelope
and from every evidence file, including the screen.

## Read-only targets

A read-only target refuses `start`, `type`, `press` and `stop` with exit code 3 and the target's
hint. `screen`, `wait` and `list` still run.

## Screen engine

The screen comes from [libghostty-vt](https://github.com/ghostty-org/ghostty) 1.0, compiled to WASM
and committed as `ghostty/ghostty-vt.wasm`. `ghostty/ghostty-vt.json` records the tag, the commit,
the Zig version and the sha256 of the file. `bun run build:ghostty` rebuilds both, and needs `zig`
0.17.0 on the path.

The WASM has no imports, so the engine cannot answer a program's queries to the terminal, such as a
cursor position request. A program that waits for such an answer stalls.
