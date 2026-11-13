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
`bun verify.ts action seed --count 3`. The CLI lists the built-in commands, such as `up`, `doctor`
and `lint`, beside the commands that the registry declares and that its drivers add. A registry
can't declare a command named `lint`: `runVerify` throws `Two commands share the name`, as `build()`
does on any duplicate name.

`skill` is the path, from the repo root, of the folder that holds the repo's verify skill: the
Markdown that tells the repo's agents how to use each feature. `lint` reads that folder. The path
defaults to `.claude/skills/verify`.

## Guide

The package ships a guide in `guide/`. It walks an agent through adding a verify CLI, a feature map
and a verify skill to a repo, and through the checks that prove them. Its `template/` folder holds
the example files for the repo's own verify skill, which the agent writes.

The CLI prints the guide of the installed version, so no copy in the repo goes stale:

```bash
bun verify guide            # the version and the topics
bun verify guide create     # one topic
bunx wringer-gunshi guide   # the same, for a repo that has no verify CLI yet
```

An unknown topic fails with `usage`, and its hint lists the topics. `guide template` prints the
absolute path of the installed template folder, to copy from. `--human` prints a topic's text alone.

## lint

`bun verify.ts lint` checks the features and the verify skill with no running app, so CI can run it
on a fresh checkout. It exits with code 1 and `check-failed` on any of these:

- a feature, `.shared()` or `.ignore()` glob that matches no file, or a file that no such glob
  matches;
- a missing or orphaned `references/feature-<name>.md`, or a feature file without `## Journey` and
  `## End state` or whose first `bash` line is not `<cli> use --feature <name>`;
- a `SKILL.md` feature table, between the `wringer:features` markers, that differs from
  `features --markdown`;
- a registry file that no `.shared()` or feature `paths` glob matches;
- a line in a fenced code block of the skill's Markdown files that calls the CLI and fails to parse,
  fails the command's schema, or names a feature or target the registry lacks;
- a missing `SKILL.md`, a frontmatter without `metadata.wringer-template` or
  `metadata.wringer-command`, or another template hash. The `maintain` guide topic upgrades it.

`metadata.wringer-command` holds the words that call the CLI, such as `bun verify`. `lint` checks
only code block lines that start with them, after an optional `$ ` prompt and assignments.

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
