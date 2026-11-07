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

await runVerify(registry, { skill: '.claude/skills/verify' });
```

Run it as `bun verify.ts <command>`, for example `bun verify.ts up` or
`bun verify.ts action seed --count 3`. The CLI holds the built-in commands, such as `up`, `doctor`
and `lint`, beside the registry's actions, commands and driver commands.

`skill` is the path, from the repo root, of the folder that holds the repo's verify skill: the
Markdown that tells the repo's agents how to drive each feature. `lint` reads it. It defaults to
`.claude/skills/verify`.

## Build skill

The package ships an agent skill in `skills/wringer/`. It walks an agent through adding a verify
CLI, a feature map and a verify skill to a repo, and through the checks that prove them. Its
`template/` folder holds the example files the agent copies. Copy the installed version into the
repo, after you remove any older copy:

```bash
rm -rf .claude/skills/wringer
mkdir -p .claude/skills
cp -R node_modules/@wringer/gunshi/skills/wringer .claude/skills/wringer
```

## lint

`bun verify.ts lint` checks the feature map and the verify skill without starting the app, so CI can
run it on a fresh checkout. It exits with code 1 and the error code `check-failed` when it finds any
of these:

- a feature's `paths` glob that matches none of the repo's files, tracked or untracked, that git
  does not ignore;
- a line in a fenced code block of the verify skill's Markdown files that calls the CLI and fails to
  parse, or whose arguments fail the command's schema;
- a verify skill whose `metadata.wringer-template` differs from the template version that this
  package ships, or that lacks `metadata.wringer-template` or `metadata.wringer-command`.

`metadata.wringer-command` holds the words that call the CLI, such as `bun verify`. `lint` checks
only the code block lines that start with those words, after an optional `$ ` prompt and environment
assignments.

## Behaviour

- Each command prints one JSON envelope. A streaming command, such as `doctor`, prints its NDJSON
  events first.
- The CLI prints text in place of JSON when stdout is a terminal and no coding agent runs it.
  `--human` and `--json` choose the format.
- An unknown flag, a flag of the wrong type or arguments that fail the command's schema end in a
  `usage` envelope and exit code 2. So does a flag with no value after it; write `--label ''` to
  pass an empty one.
- Write a negative value with `=`, as in `--degrees=-15`. The parser reads `--degrees -15` as two
  short options, and the usage envelope's hint gives the joined form. Put a negative positional
  after `--`, as in `lean -- -15`.
- A flag of an object or a list of objects takes JSON text, such as `--address '{"town":"Hollin"}'`.
- When a command's arguments are a union of objects, each branch's fields are flags, and the
  command's schema picks the branch.
- Every command takes `--target`, `--feature` and `--timeout-ms`, unless it declares an argument of
  the same name. `use --target` sets the target for later commands, where `status --target` reads
  one target once.
- `--help` marks each command `[read]` or `[write]`, so a reader sees which commands a read-only
  target refuses. A command whose arguments decide, such as `db query`, shows `[read or write]`.
- The script starts itself again, detached, as the run's supervisor, so `up` and `attach` need no
  separate daemon.
