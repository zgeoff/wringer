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
it. A drive is any action, repo command or driver command, reads included, such as `browser click`
or `http request`; a driver is a package that adds a group of commands, such as `http`. The built-in
commands, such as `use` and `report`, are not drives. `bun verify done` records the verdict that the
feature works on the current working tree, and a commit of the same change keeps it. The CI gate,
`bun verify gate`, fails a PR when a feature it changes has no verdict for its code, so hand back
the output of `bun verify report --human` for the PR body.

The mistakes that cost the most time:

- **Driving before `doctor` passes.** Every drive fails with exit code 3 until the doctor passes on
  the current run.
- **Editing the app's code during a run.** A verdict holds only for the code the run started on.
  After an edit, run `bun verify up --restart` and `bun verify doctor` again. On an attach target,
  run `detach` and `attach` in place of `up --restart`.
- **Branching on the error message.** Branch on the exit code and `error.code`. The message text can
  change in any release.

## Key rules

- [Run the loop](#run-the-loop): up, doctor, use, drive, done, report.
- [Read the envelope](#read-the-envelope): one JSON object per command, and an exit code to branch
  on.
- [Targets](#targets): the targets this repo declares, and what a read-only target refuses.
- [Commands](#commands): `bun verify --help` lists every command, each marked read or write.
- [Feature map](#feature-map): the file that holds each feature's Drive block and end state.
- [Keep the map true](#keep-the-map-true): fix a Drive block in the PR that breaks it, and run
  `lint`.

## References

- [Feature map](./references/feature-map.md): each feature's entry, before you drive it.

## Run the loop

1. Run `bun verify report`. Each feature with `changed: true` touches a file the change edits, and
   needs a verdict.
2. Start a run on `local`, unless your task names another target, with the command the
   [Targets](#targets) table gives. Expect: `ok: true`, and the app's endpoints in `data.endpoints`.
3. Run `bun verify doctor`. Expect: `data.passed: true`. When a check fails, fix its cause, and run
   `doctor` again.
4. Run the feature's Drive block from the [feature map](./references/feature-map.md). Its first
   line, `use --feature`, files the evidence of each later drive under that feature.
5. Check the end state. When it is wrong because of your change, fix the app's code, run
   `bun verify up --restart` and `bun verify doctor`, and run the Drive block again. Otherwise
   report the failure.
6. Run `bun verify done`. Expect: `ok: true`. It fails unless a drive of the feature exited 0 after
   the doctor passed.
7. Repeat steps 4 to 6 for each feature with `changed: true`.
8. Run `bun verify report --human`, and put its output in the PR body in place of any older report.
   Keep the HTML comment at its end: the gate reads the report from it.
9. Stop the run: `bun verify down` on a launch target, or `bun verify detach` on an attach target.

## Read the envelope

Each command prints one JSON envelope as its last line. A streaming command, such as `doctor`,
prints its events as JSON lines before it. Read these fields:

- `ok`, then `data` on success, or `error.code`, `error.message` and `error.hint` on failure;
- `evidence`: the files the command kept, under `.wringer/`;
- `truncated` and `truncatedPath`: `data` was too large, and the file at `truncatedPath` holds it.

| Exit | `error.code`                                                        | Do                                                    |
| ---- | ------------------------------------------------------------------- | ----------------------------------------------------- |
| 0    | none                                                                | Go on.                                                |
| 1    | `check-failed`                                                      | The app failed a drive or a check. Read the evidence. |
| 2    | `usage`                                                             | Fix the command; `--help` shows its flags.            |
| 3    | `read-only`, `doctor-required`, `not-running`, `target-not-allowed` | Follow `error.hint`.                                  |
| 4    | `environment`, `internal`                                           | Fix the tool or the host, then retry.                 |
| 5    | `timeout`                                                           | Retry once with a larger `--timeout-ms`.              |

## Targets

A launch target is one whose app `bun verify up` starts and `bun verify down` stops. An attach
target is an app that `bun verify` did not start: `attach` and `detach` connect to it and leave it
running. Run `bun verify use --target <target>` to point later commands at a target; `--target` on
one command overrides it.

<!-- repo: targets -->

| Target   | Start with                          | Access     | Notes                                                  |
| -------- | ----------------------------------- | ---------- | ------------------------------------------------------ |
| `local`  | `bun verify up`                     | read-write | Starts the app with `bun run dev`.                     |
| `shared` | `bun verify attach --target shared` | read-only  | An app that `bun verify` did not start. Never stop it. |

A read-only target refuses a write with exit code 3 and `read-only`. Stop, and report the write you
needed to whoever gave you the task.

<!-- /repo -->

## Commands

Run `bun verify --help` for the list, and `bun verify <command> --help` for a command's flags. The
help marks each command `[read]` or `[write]`.

- Run `bun verify <group> --help` to list the commands in a group, such as `action`. The top-level
  list shows the group alone.
- Each driver adds its own group, such as `http` or `browser`.
- Write a negative number with `=`, as in `--offset=-5`.
- Pass an object as JSON text, as in `--filter '{"shelf":"top"}'`.

<!-- repo: commands -->

- `bun verify action add-item --name <name>` adds an item through the API.
- `bun verify items count` counts the items through the API, in `data.count`.

<!-- /repo -->

## Feature map

The [feature map](./references/feature-map.md) holds one entry per feature: what it does, how a user
reaches it in the app, its Drive block, and the end state that shows it works. Read a feature's
entry before you drive it. `bun verify features` lists each feature's `paths`: the files whose
change makes the gate ask for its verdict.

## Keep the map true

<!-- repo: registry -->

The registry, `scripts/verify/verify-registry.ts`, declares the targets, actions, commands, doctor
checks and features, with each feature's `paths`.

<!-- /repo -->

- When a change touches a file under a feature's `paths`, drive that feature and run `done` before
  the PR.
- When a Drive block no longer works because the feature changed, fix it in the same PR.
- In this file, edit only inside the `<!-- repo -->` blocks. The lines outside them come from the
  wringer template, and an upgrade of the template replaces them. The repo owns the feature map
  whole.
- Run `bun verify lint` after you change this skill or the registry. It fails on a `paths` glob that
  matches no file, a command in a code block that would fail before it ran, such as one with an
  unknown flag or feature, and a skill written from an older template.

**Reply:** the output of `bun verify report --human`, and each feature you could not verify, with
the command that failed and its `error.code`.
