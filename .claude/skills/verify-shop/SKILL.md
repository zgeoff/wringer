---
name: verify-shop
description:
  'Uses the example shop app the way a user would with `bun verify`, and records the verdict that a
  feature works. Load it before you check a change to the shop example in the running app, run a
  journey from its feature map, or put the verdicts in a PR.'
metadata:
  wringer-template: 1
  wringer-command: bun verify
---

# Verify the shop example

Use `bun verify` to start the app, use each feature your change touches the way a user would, and
record a verdict that it works. Hand back the output of `bun verify report --human` and each feature
you could not verify. The CI gate, `bun verify gate`, fails a PR that changes a feature with no
verdict.

The mistakes that cost the most time:

- **Using the app before `doctor` passes.** `bun verify doctor` checks that the app answers and that
  each driver works. Until it passes on the current run, the one that `up` or `attach` started, any
  command that touches the app fails with exit code 3.
- **Editing the app's code while `up` runs it.** The next command that touches the app fails with
  `doctor-required`. Run `bun verify up --restart` and `bun verify doctor`, then run the feature's
  journey again.
- **Running `done` before you check the end state.** `done` checks only that a journey command after
  `use`, such as an `action` or a `browser` command, succeeded. It does not check the result. Check
  the end state yourself first.
- **Branching on the error message.** Branch on the exit code and `error.code`. The message text can
  change in any release.

## Key rules

- [Check a change](#check-a-change): report, start a run, doctor, then run the journey, check the
  end state and `done` for each feature, then report again and end the run.
- [Read the envelope](#read-the-envelope): one JSON object per command, and an exit code to branch
  on.
- [Targets](#targets): the targets this repo declares; check a change on one that `up` starts.
- [Commands](#commands): `bun verify --help` lists every command, each marked read or write.
- [Feature map](#feature-map): the file that holds each feature's journey and end state.
- [Update the feature map](#update-the-feature-map): fix a broken journey in the same PR, and run
  `lint`.

## References

- [Feature map](./references/feature-map.md): each feature's entry, before you run it.

## Check a change

1. Run `bun verify report`. Each feature in `data.report.features` with `changed: true` has a file
   under its `paths` that differs from the default branch, committed or not. Each one needs a
   verdict.
2. Unless your task names another target, start a run on `local`, with the commands in the
   [Targets](#targets) table. Expect: `ok: true`, and the app's endpoints in `data.endpoints`.
3. Run `bun verify doctor`. Expect: `data.passed: true`. When a check fails, fix its cause, and run
   `doctor` again.
4. Run the feature's journey from the [feature map](./references/feature-map.md). Its first line,
   `use --feature`, records each later command under that feature, and keeps the target you set.
   Expect: each command exits 0.
5. Compare the app with the feature's end state:
   - When it matches, and no command was refused, go on to step 6.
   - When your change broke it, fix the app's code, run `bun verify up --restart` and
     `bun verify doctor`, and run the journey again.
   - Otherwise, skip `done` for this feature. List it in your reply with the end state you expected
     and the `data` you got.
6. Run `bun verify done`. It records a verdict for the feature that `use --feature` set. Expect:
   `ok: true`. If no journey command after `use --feature` succeeded since `doctor` passed, it fails
   with exit code 1 and `check-failed`.
7. Repeat steps 4 to 6 for each feature with `changed: true`, and for each feature your task names,
   in the order the feature map lists them, unless the map asks for another. A task's list of
   features sets no order. The gate checks only the changed features. When a changed feature has no
   entry in the feature map, write one, and run `bun verify lint`.
8. Run `bun verify report --human`. A changed feature with your verdict shows `verified`; a feature
   the branch doesn't change shows `unchanged`, with your verdict's evidence. After `done`, an edit
   to any file on the branch makes every verdict `stale`, unless you commit the same code. Repeat
   steps 4 to 6 for each stale feature.
9. Put the whole output in the PR body, in place of the output of an older `report --human`. Keep
   the HTML comment at the end of the output: the gate reads the report from it.
10. End the run: `bun verify down` after `up`, or `bun verify detach` after `attach`.

## Read the envelope

Each command prints one JSON envelope as its last line. With `--human`, it prints text for a person
in its place. A streaming command, such as `doctor`, prints its events as JSON lines before the
envelope. Read these fields:

- `ok`, then `data` on success, or `error.code`, `error.message` and `error.hint` on failure;
- `evidence`: the files the command kept, under `.wringer/`;
- `truncated` and `truncatedPath`: `data` was too large, and the file at `truncatedPath` holds it.

| Exit | `error.code`         | Do                                                                                           |
| ---- | -------------------- | -------------------------------------------------------------------------------------------- |
| 0    | none                 | Go on.                                                                                       |
| 1    | `check-failed`       | Read the evidence, then go on as step 5 says.                                                |
| 2    | `usage`              | Fix the command; `--help` shows its flags.                                                   |
| 3    | `read-only`          | Leave the write undone, skip `done` for the feature, and list the write in your reply.       |
| 3    | `doctor-required`    | Run the commands in `error.hint`, then run the feature's journey again.                      |
| 3    | `not-running`        | Start the run, as step 2 says.                                                               |
| 3    | `target-not-allowed` | Follow `error.hint`.                                                                         |
| 4    | `environment`        | Read `error.message`, fix the problem on this machine, such as a missing browser, and retry. |
| 4    | `internal`           | Report the command and `error.message`: the CLI has a bug.                                   |
| 5    | `timeout`            | Retry once with twice the timeout; the default is `--timeout-ms=120000`. Then report it.     |

## Targets

Start a launch target's app with `bun verify up`, and stop it with `bun verify down`. Connect to an
attach target with `bun verify attach`: an attach target is an app that runs apart from
`bun verify`, and `bun verify detach` leaves it running. Your edits never reach an attach target's
app, so check a change on a launch target.

Run `bun verify use --target <target>` to point every later command at a target. `--target` on one
command points that command alone.

<!-- repo: targets -->

To start a shop for `demo`, run `bun packages/shop-example/src/shop-app.ts` in the background. Its
first line is JSON with the port, such as `{"event":"listening","port":4310}`. After
`bun verify detach`, stop that process. Never stop a shop that someone else started.

| Target  | Start with                                                                                     | Access     | Notes                                                       |
| ------- | ---------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------- |
| `local` | `bun verify use --target local`, then `bun verify up`                                          | read-write | Starts the shop with an empty database in the run's folder. |
| `demo`  | `bun verify use --target demo`, then `SHOP_DEMO_URL=http://127.0.0.1:<port> bun verify attach` | read-only  | A shop that `bun verify` did not start.                     |

<!-- /repo -->

## Commands

Run `bun verify --help` for the list, and `bun verify <command> --help` for a command's flags. The
help marks each command `[read]` or `[write]`.

- Run `bun verify <group> --help` to list the commands in a group, such as `action`. The top-level
  list shows the group alone.
- Write a negative number with `=`, as in `--offset=-5`.
- Pass an object as JSON text, as in `--filter '{"shelf":"top"}'`.

<!-- repo: commands -->

- `bun verify action place-order` places one order through the API, as the page's button does, and
  returns its `id` in `data.id`.
- `bun verify orders count` counts the rows of the `orders` table, in `data.orders`.
- `bun verify db query '<sql>'` runs SQL on `local`'s database. Add `--write` for a statement that
  writes.
- `bun verify browser snapshot` returns the page's accessibility tree.
- `bun verify stream read app` returns the app's log lines since `use` last ran. It keeps no
  evidence file, so quote the line you checked in your reply. Add `--from 0` to read from the start
  of the run.

<!-- /repo -->

## Feature map

Before you run a feature's journey, read its entry in the
[feature map](./references/feature-map.md): what it does, how a user reaches it, its journey and its
end state. `bun verify features` lists each feature's `paths`: the files whose change makes the gate
ask for its verdict.

## Update the feature map

<!-- repo: registry -->

The registry,
[`create-shop-registry.ts`](../../../packages/shop-example/src/create-shop-registry.ts), declares
the targets, actions, commands, doctor checks and features, with each feature's `paths`.

This repo's CI runs `lint` through a test, and does not run `gate`. An edit to this skill or its
feature map is a skill edit. Before you make one, follow the skill steps in
[AGENTS.md](../../../AGENTS.md), and give their proof in the PR.

<!-- /repo -->

- When a feature's journey stops working because the feature changed, fix it in the same PR.
- In this file, edit only the frontmatter's `name` and `description`, the `#` title, and the lines
  inside the `<!-- repo -->` blocks. An upgrade of the template keeps those and replaces every other
  line. The repo owns the feature map whole.
- After you change this skill, its feature map or the registry, run `bun verify lint`. It fails on:
  - a `paths` glob that matches no file;
  - a command in a code block that would fail before it ran, such as one with an unknown flag,
    feature or target;
  - a skill written from an older template. Load the `wringer` skill that `@wringer/gunshi` ships,
    and follow its upgrade steps.

**Reply:** the output of `bun verify report --human`, and each feature you could not verify, with
the command that failed and its `error.code`, or the end state you expected and the `data` you got.
