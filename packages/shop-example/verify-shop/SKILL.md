---
name: verify-shop
description:
  'Uses the example shop app the way a user would with `bun verify`, and records the verdict that a
  feature works. Load it before you check a change to the shop example in the running app, run the
  journey of a feature, or put the verdicts in a PR.'
metadata:
  wringer-template: 'sha256:398945db7563'
  wringer-command: bun verify
---

# Verify the shop example

Use `bun verify` to start the app, use each feature your change touches the way a user would, and
record a verdict that it works. Put the report in the PR with `bun verify publish`, and hand back
the PR link and each feature you could not verify. Leave `bun verify gate` to CI: it reads the
report from the PR description, and fails a PR that changes a feature with no verdict there.

## Key rules

- [Check a change](#check-a-change): for each changed feature, run its journey, check the end state,
  then `done`.
- [Read the envelope](#read-the-envelope): branch on the exit code and `error.code`, never on the
  message, which can change in any release.
- [Targets](#targets): check a change on a launch target, a target whose app `bun verify up` starts
  from your worktree.
- [Commands](#commands): read `--help` before you guess a flag.
- [Edit the skill and the registry](#edit-the-skill-and-the-registry): map each new file in the
  registry, read the reference before you edit the skill, and run `lint`.

## References

- [Exit codes](references/exit-codes.md): when a command fails, what to do for its exit code and
  `error.code`.
- [Edit the skill](references/edit-the-skill.md): before you edit this skill or a feature file.

Read a feature's file before you run its journey.

<!-- wringer:features -->

| Feature       | Summary                                       | File                                                                       |
| ------------- | --------------------------------------------- | -------------------------------------------------------------------------- |
| place-order   | Place an order from the shop page             | [references/feature-place-order.md](references/feature-place-order.md)     |
| order-failure | Show on the page that an order failed         | [references/feature-order-failure.md](references/feature-order-failure.md) |
| list-orders   | List the placed orders through the orders API | [references/feature-list-orders.md](references/feature-list-orders.md)     |
| order-log     | Log one line for each order placed            | [references/feature-order-log.md](references/feature-order-log.md)         |

<!-- /wringer:features -->

## Check a change

1. Run `bun verify report`. In `data.report.features`, a feature shows `changed: true` when a file
   that matches its `paths` in the [registry](#edit-the-skill-and-the-registry) differs from the
   default branch, committed or not.
2. Pick the target your task names. When it names none, take the first launch target in the
   [Targets](#targets) table. Run the commands in its row. `up` or `attach` starts a run, which
   lasts until `down` or `detach`. Expect from `up` or `attach`: `ok: true`, and the app's endpoints
   in `data.endpoints`.
3. Run `bun verify doctor`. Expect: `data.passed: true`. When a check fails, fix its cause, and run
   `doctor` again.
4. Run the journey from the feature's file in [References](#references). Its first line,
   `use --feature`, records each later command under that feature, and leaves the target as it is.
   Expect: each command exits 0. When one fails, do what its row in
   [Exit codes](references/exit-codes.md) says.
5. Compare the app with the feature's end state:
   - When it matches, and no command failed with `read-only`, go on to step 6.
   - When your change broke the feature, fix the app's code. Then run `bun verify up --restart`,
     `bun verify doctor` and the journey again.
   - When your change means to change the end state, fix the feature's file, and run
     `bun verify lint`. Then run the journey again.
   - In any other case, such as a `read-only` failure or a bug your change did not cause, skip
     `done` for this feature. List it in your reply with the end state you expected and the `data`
     you got.
6. Record the verdict:
   - Finish each edit to a file that matches the feature's `paths` first. An edit after `done` makes
     the verdict `stale`. A commit alone leaves the verdict as it was.
   - Once the end state matches in step 5, run `bun verify done`. Expect: `ok: true`. `done` records
     a verdict for the feature that `use --feature` set.
   - `done` checks only that a journey command succeeded after `doctor`, and never reads the end
     state. Until a journey command succeeds, `done` fails with `check-failed`.
7. Repeat steps 4 to 6 for each feature with `changed: true`, and for each feature your task names,
   in the order of the table in [References](#references). When the [Targets](#targets) section says
   to run a feature's journey last, run it after every other journey.
8. Run `bun verify report --human` to read the report. Expect: `verified` on each changed feature
   you did not skip in step 5. Repeat steps 4 to 6 for each `stale` feature.
9. Push the branch, and open a PR for it when none is open. Without an open PR, `publish` fails and
   writes nothing. Run `bun verify publish`, even when you skipped a feature. To write to a PR other
   than the branch's own, add `--pr <number>`. Expect: `ok: true`, and `data.action` of `created`,
   `replaced` or `unchanged`. It writes the report into the PR's description, the only report the
   gate reads.
10. End the run: `bun verify down` after `up`, or `bun verify detach` after `attach`.

## Read the envelope

Each command prints one JSON envelope as its last line, or text with `--human`. A streaming command,
such as `doctor`, prints JSON event lines before the envelope. Add `--brief` to print one short line
instead, with no event lines: `<command> ok=<true|false>`, then `error.code` and `error.message` on
failure or `data` on success, each cut at 200 characters, then `truncatedPath` when the data was too
large, then `evidence=<count>`. `--brief` leaves out `error.hint`: read it in
[Exit codes](references/exit-codes.md), or run the command with `--help`. Read these fields:

- `ok`, then `data` on success, or `error.code`, `error.message` and `error.hint` on failure;
- `evidence`: the files the command kept, under `.wringer/`;
- `truncatedPath`: the file that holds `data` when it was too large to print.

When a command fails, find its exit code and `error.code` in [Exit codes](references/exit-codes.md),
and do what that row says.

## Targets

Start a launch target's app with `bun verify up`, and stop it with `bun verify down`. Connect to an
attach target, a target whose app runs apart from `bun verify`, with `bun verify attach`.
`bun verify detach` leaves it running. Your edits never reach an attach target's app, so check a
change on a launch target.

Run `bun verify use --target <target>` to point every later command at a target. `use` saves the
choice in this worktree's `.wringer/`, for every shell and session. `--target` on one command points
that command alone. A command with neither runs on the registry's first target, so run `use` first.

<!-- repo: targets -->

| Target  | Start with                                                                                     | Access     | Notes                                   |
| ------- | ---------------------------------------------------------------------------------------------- | ---------- | --------------------------------------- |
| `local` | `bun verify use --target local`, then `bun verify up`                                          | read-write | An empty database in the run's folder.  |
| `demo`  | `bun verify use --target demo`, then `SHOP_DEMO_URL=http://127.0.0.1:<port> bun verify attach` | read-only  | An app that `bun verify` did not start. |

To try `demo`, run `bun packages/shop-example/src/shop-app.ts` in the background; its first output
line holds the port. After `bun verify detach`, stop only an app you started.

Run `order-failure` last. It drops the `orders` table, so every later order fails until
`bun verify up --restart` and `bun verify doctor`.

<!-- /repo -->

## Commands

Run `bun verify --help` for the list, with each command marked `[read]` or `[write]`. A read-only
target refuses each `[write]` command except `publish`, which writes no app data. `up` and `down`
are `[read]`, but start and stop the app. Run `bun verify <command> --help` for a command's flags.
The top-level list shows only the name of a group, such as `action`: run `bun verify <group> --help`
for its commands.

- Write a negative number with `=`, as in `--offset=-5`.
- Pass an object as JSON text, as in `--filter '{"shelf":"top"}'`.

<!-- repo: commands -->

- `bun verify action place-order` places an order, with its `id` in `data.id`.
- `bun verify orders count` counts the orders, in `data.orders`.
- `bun verify db query '<sql>'` runs SQL on `local`'s database; add `--write` to write.
- `bun verify stream read app` returns the log lines since any `use` last ran. It keeps no evidence:
  quote the line in your reply.

<!-- /repo -->

## Edit the skill and the registry

<!-- repo: registry -->

The registry, [`create-shop-registry.ts`](../src/create-shop-registry.ts), declares each feature's
`paths` and the ignore list.

CI here runs `lint` through a test and never `gate`: list each feature you skip in your reply.
Before you edit this skill or a feature file, follow the skill steps in
[AGENTS.md](../../../AGENTS.md).

<!-- /repo -->

In the registry, map each file your change adds: add a glob that matches it to a feature's `paths`,
to `.shared()` or to `.ignore()`. The gate fails on a changed file that no glob matches. Add a file
that the running app never reads, such as a test, to `.ignore()`. `bun verify features` lists the
globs.

When a change to a feature breaks its journey, fix the journey in the same PR. Before you edit this
skill or a feature file, read [Edit the skill](references/edit-the-skill.md). After you change this
skill, a feature file or the registry, run `bun verify lint`, and fix each failure it reports.

**Reply:** the PR link that `bun verify publish` returned in `data.pr.url`, and each feature you
could not verify, with the command that failed and its `error.code`, or the end state you expected
and the `data` you got.
