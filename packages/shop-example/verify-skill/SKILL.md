---
name: verify-shop
description:
  'Uses the example shop app the way a user would with `bun verify`, and records the verdict that a
  feature works. Load it before you check a change to the shop example in the running app, run the
  journey of a feature, or put the verdicts in a PR.'
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
  each driver works. Until it passes on the run that `up` or `attach` started, any command that
  touches the app fails with exit code 3.
- **Editing the app's code while `up` runs it.** The next command that touches the app fails with
  `doctor-required`. Run `bun verify up --restart` and `bun verify doctor`, then the journey again.
- **Running `done` before you check the end state.** `done` checks only that one command of the
  journey succeeded. Check the result yourself first.
- **Branching on the error message.** Branch on the exit code and `error.code`. The message text can
  change in any release.

## Key rules

- [Check a change](#check-a-change): for each changed feature, run its journey, check the end state,
  then `done`.
- [Read the envelope](#read-the-envelope): branch on the exit code and `error.code`.
- [Targets](#targets): check a change on a target that `up` starts.
- [Commands](#commands): `bun verify --help` lists every command.
- [Update a feature file](#update-a-feature-file): fix a broken journey in the same PR, and run
  `lint`.

## References

Read a feature's file before you run its journey: what the feature does, how a user reaches it, the
journey of `bun verify` commands, and the end state that shows it works.

<!-- wringer:features -->

| Feature       | Summary                                       | File                                                                       |
| ------------- | --------------------------------------------- | -------------------------------------------------------------------------- |
| place-order   | Place an order from the shop page             | [references/feature-place-order.md](references/feature-place-order.md)     |
| order-failure | Show on the page that an order failed         | [references/feature-order-failure.md](references/feature-order-failure.md) |
| list-orders   | List the placed orders through the orders API | [references/feature-list-orders.md](references/feature-list-orders.md)     |
| order-log     | Log one line for each order placed            | [references/feature-order-log.md](references/feature-order-log.md)         |

<!-- /wringer:features -->

## Check a change

1. Run `bun verify report`. A feature in `data.report.features` shows `changed: true` when a file
   under its `paths` differs from the default branch, committed or not. Each changed feature needs a
   verdict.
2. Unless your task names another target, start a run on `local`, with the commands in the
   [Targets](#targets) table. Expect from `up` or `attach`: `ok: true`, and the app's endpoints in
   `data.endpoints`.
3. Run `bun verify doctor`. Expect: `data.passed: true`. When a check fails, fix its cause, and run
   `doctor` again.
4. Run the journey from the feature's file in [References](#references). Its first line,
   `use --feature`, records each later command under that feature, and leaves the target as it is.
   Expect: each command exits 0.
5. Compare the app with the feature's end state:
   - When it matches, and no command failed with `read-only`, go on to step 6.
   - When your change broke the feature, fix the app's code. Then run `bun verify up --restart`,
     `bun verify doctor` and the journey again.
   - When your change means to change the end state, fix the feature's file, and run
     `bun verify lint`. Then run the journey again.
   - Otherwise, skip `done` for this feature. List it in your reply with the end state you expected
     and the `data` you got.
6. Run `bun verify done` to record a verdict for the feature that `use --feature` set. Expect:
   `ok: true`. It fails with `check-failed` until a journey command succeeds after `doctor`.
7. Repeat steps 4 to 6 for each feature with `changed: true`, and for each feature your task names,
   in the order of the table in [References](#references). When [Targets](#targets) names a journey
   to run last, run it last.
8. Run `bun verify report --human`. Expect: `verified` on each changed feature. After `done`, an
   edit to a file under a feature's `paths` makes its verdict `stale`; a commit alone leaves each
   verdict as it was. Repeat steps 4 to 6 for each stale feature.
9. Put the whole output in the PR body, in place of any older report. Keep the HTML comment at the
   end of the output: the gate reads the report from it.
10. End the run: `bun verify down` after `up`, or `bun verify detach` after `attach`.

## Read the envelope

Each command prints one JSON envelope as its last line, or text for a person with `--human`. A
streaming command, such as `doctor`, prints JSON event lines before it. Read these fields:

- `ok`, then `data` on success, or `error.code`, `error.message` and `error.hint` on failure;
- `evidence`: the files the command kept, under `.wringer/`;
- `truncated` and `truncatedPath`: `data` was too large, and the file at `truncatedPath` holds it.

| Exit | `error.code`         | Do                                                                                                |
| ---- | -------------------- | ------------------------------------------------------------------------------------------------- |
| 0    | none                 | Go on.                                                                                            |
| 1    | `check-failed`       | Read the evidence. When `done` failed, run the journey again; else go on as step 5 says.          |
| 2    | `usage`              | Fix the command; `--help` shows its flags.                                                        |
| 3    | `read-only`          | Leave the write undone, skip `done` for the feature, and list the write in your reply.            |
| 3    | `doctor-required`    | Run the commands in `error.hint`, then run the feature's journey again.                           |
| 3    | `not-running`        | Start the run, as step 2 says.                                                                    |
| 3    | `target-not-allowed` | Follow `error.hint`.                                                                              |
| 4    | `environment`        | Read `error.message`, fix the problem on this machine, such as a missing browser, and retry.      |
| 4    | `internal`           | Report the command and `error.message`: the CLI has a bug.                                        |
| 5    | `timeout`            | Retry once with twice the timeout; the default is `--timeout-ms=120000`. Report a second timeout. |

## Targets

Start a launch target's app with `bun verify up`, and stop it with `bun verify down`. Connect to an
attach target, an app that runs apart from `bun verify`, with `bun verify attach`.
`bun verify detach` leaves it running. Your edits never reach an attach target's app, so check a
change on a launch target.

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

Run every journey on `local`. Each journey writes, and the read-only `demo` target refuses writes.

Run the `order-failure` journey last. It drops the `orders` table, so every later order fails. To
run another journey after it, run `bun verify up --restart` for a new, empty database, then
`bun verify doctor`.

<!-- /repo -->

## Commands

Run `bun verify --help` for the list, with each command marked `[read]` or `[write]`. Run
`bun verify <command> --help` for a command's flags. The top-level list shows only the name of a
group, such as `action`: run `bun verify <group> --help` for its commands.

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

## Update a feature file

<!-- repo: registry -->

The registry, [`create-shop-registry.ts`](../src/create-shop-registry.ts), declares each feature's
`paths` and the `.ignore` list.

This repo's CI runs `lint` through a test and never runs `gate`. An edit to this skill or a feature
file is a skill edit. Before you make one, follow the skill steps in
[AGENTS.md](../../../AGENTS.md), and give their proof in the PR.

<!-- /repo -->

- When a feature's journey stops working because the feature changed, fix the journey in the same
  PR. You may edit any line of a feature file.
- A feature file needs `## Journey`, whose first `bash` line is `bun verify use --feature <name>`,
  and `## End state`.
- In this SKILL.md, edit only the frontmatter's `name` and `description`, the `#` title, and the
  lines inside each `<!-- repo: <name> -->` block. An upgrade of the template replaces every other
  line.
- Replace the table between the `wringer:features` markers with the output of
  `bun verify features --markdown`.
- Make each changed file match a feature's `paths` or a glob in the registry's `.ignore` list. The
  gate fails on a changed file that matches neither. `bun verify features` lists each feature's
  `paths`.
- After you change this skill, a feature file or the registry, run `bun verify lint`, and fix each
  failure it reports. When it reports an older template, run `bun verify guide maintain`, and follow
  its steps to upgrade the template.

**Reply:** the output of `bun verify report --human`, and each feature you could not verify, with
the command that failed and its `error.code`, or the end state you expected and the `data` you got.
