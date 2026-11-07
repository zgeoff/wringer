---
name: verify
description:
  'Drives the Larder app the way a user would with `bun verify`, and records the verdict that a
  feature works. Load it before you check a change in the running app, drive a feature in the
  feature map, or put the verdicts in a PR.'
metadata:
  wringer-template: 1
  wringer-command: bun verify
---

# Verify Larder

Use `bun verify` to start the app, drive a feature the way a user would, and record a verdict for
it. Hand back the Markdown that `bun verify report --human` prints, for the PR body. A CI gate
checks that every feature the PR changes has a verdict for the current code.

The mistakes that cost the most time:

- **Driving before `doctor` passes.** Every drive command fails with exit code 3 until it passes on
  the current run.
- **Editing code during a run.** A verdict counts only for the tree the run started on. After an
  edit, run `bun verify up --restart` and `bun verify doctor` again.
- **Reading the message instead of the code.** Branch on the exit code and `error.code`; the message
  text changes between versions.

## Key rules

- [Run the loop](#run-the-loop): up, doctor, use, drive, done, report.
- [Read the envelope](#read-the-envelope): one JSON object per command, and an exit code to branch
  on.
- [Targets](#targets): the targets this repo declares, and what a read-only target refuses.
- [Commands](#commands): `bun verify --help` lists every command, each marked read or write.
- [Feature map](#feature-map): each feature's journey and the end state that proves it.
- [Keep the map true](#keep-the-map-true): fix a journey in the PR that breaks it, and run `lint`.

## Run the loop

1. Start a run: `bun verify up` on a launch target, or `bun verify attach --target <target>` on an
   attach target. Expect `ok: true` and the app's endpoints in `data`.
2. Run `bun verify doctor`. Fix each failed check, then run it again.
3. Set the feature: `bun verify use --feature <feature>`. Each later drive records its evidence
   under that feature.
4. Drive the journey from the [feature map](#feature-map), and check its end state.
5. Run `bun verify done`. It refuses unless a drive of the feature passed after the doctor.
6. Repeat steps 3 to 5 for each feature the change touches. `bun verify report` lists them.
7. Run `bun verify report --human`, and put its output in the PR body. Keep the hidden block at its
   end: the gate reads it.
8. Stop the run: `bun verify down`, or `bun verify detach` on an attach target.

## Read the envelope

Each command prints one JSON envelope. A streaming command, such as `doctor`, prints its events as
JSON lines first. Read these fields:

- `ok`, then `data` on success, or `error.code`, `error.message` and `error.hint` on failure;
- `evidence`: the files the command kept, under `.wringer/`;
- `truncated` and `truncatedPath`: `data` was too large, and the file at `truncatedPath` holds it.

| Exit | `error.code`                                                        | Do                                         |
| ---- | ------------------------------------------------------------------- | ------------------------------------------ |
| 0    | none                                                                | Go on.                                     |
| 1    | `check-failed`                                                      | The app or a check failed. Investigate.    |
| 2    | `usage`                                                             | Fix the command; `--help` shows its flags. |
| 3    | `read-only`, `doctor-required`, `not-running`, `target-not-allowed` | Follow `error.hint`.                       |
| 4    | `environment`, `internal`                                           | Fix the tool or the host, then retry.      |
| 5    | `timeout`                                                           | Retry once with a larger `--timeout-ms`.   |

## Targets

<!-- repo: targets -->

| Target   | Start with                          | Access     | Notes                               |
| -------- | ----------------------------------- | ---------- | ----------------------------------- |
| `local`  | `bun verify up`                     | read-write | Starts the app with `bun run dev`.  |
| `shared` | `bun verify attach --target shared` | read-only  | The shared instance. Never stop it. |

A read-only target refuses a write with exit code 3 and `read-only`. Stop, and report the write you
needed.

<!-- /repo -->

`bun verify use --target <target>` sets the target for later commands; `--target` on one command
overrides it.

## Commands

Run `bun verify --help` for the list, and `bun verify <command> --help` for a command's flags. The
help marks each command `[read]` or `[write]`.

- Write a negative number with `=`, as in `--offset=-5`.
- Pass an object as JSON text, as in `--filter '{"shelf":"top"}'`.

<!-- repo: commands -->

- `bun verify action <name>` runs a named action, such as `action add-item`.
- `bun verify items count` counts the items through the API.

<!-- /repo -->

## Feature map

<!-- repo: features -->

### add-item

- **What:** a user adds an item to the pantry.
- **Reach:** open `/pantry`, type a name, and press Add.
- **Drive:**

  ```bash
  bun verify use --feature add-item
  bun verify action add-item --name Oats
  bun verify items count
  ```

- **End state:** `items count` returns one more item than before the action, and
  `bun verify http request --path /api/items` lists `Oats`.

<!-- /repo -->

## Keep the map true

- When a change touches a file under a feature's `paths`, drive that feature and run `done` before
  the PR. `bun verify features` lists each feature with its paths.
- When a journey no longer works because the feature changed, fix the journey in the same PR.
- Run `bun verify lint` after you change this skill or the verify registry. It fails on a `paths`
  glob that matches no file, a command in a code block that would not parse, and a skill written
  from an older template.
