---
name: verify
description:
  'Checks a change to a wringer package by running its feature through the real verify CLI against
  the shop example app with `bun verify`, and records the verdict. Load it before you check a change
  to a `@wringer/*` package, run a feature journey, or put the verdicts in a PR.'
metadata:
  wringer-template: 'sha256:5ad8a6ead397'
  wringer-command: bun verify
---

# Verify wringer

Use `bun verify` to start the shop example app, drive each feature your change touches through the
real CLI, and record a verdict. Put the report in the PR with `bun verify publish`, and hand back
the PR link and each feature you could not verify.

The mistakes that cost the most time:

- **Using the app before `doctor` passes.** Commands that touch the app fail with exit code 3.
- **Editing a package while `up` runs it.** Run `bun verify up --restart` and `bun verify doctor`,
  then the journey again.
- **Running `done` before you check the end state.** `done` checks only that a journey command
  succeeded.

## Key rules

- [Check a change](#check-a-change): for each changed feature, run its journey, check the end state,
  then `done`.
- [Read the envelope](#read-the-envelope): branch on `error.code`.
- [Commands](#commands): `bun verify --help` lists every command.
- [Update a feature file](#update-a-feature-file): change a feature file in the PR that changes its
  end state.

## References

Read a feature's file before you run its journey.

<!-- wringer:features -->

| Feature         | Summary                                                              | File                                                                           |
| --------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| browser-driver  | Drive the shop page in a real browser                                | [references/feature-browser-driver.md](references/feature-browser-driver.md)   |
| http-driver     | Send HTTP requests to the app and read the answers                   | [references/feature-http-driver.md](references/feature-http-driver.md)         |
| db-driver       | Query the app database and read the rows                             | [references/feature-db-driver.md](references/feature-db-driver.md)             |
| stream-driver   | Read the app's log lines                                             | [references/feature-stream-driver.md](references/feature-stream-driver.md)     |
| terminal-driver | Drive the shop's terminal screen in a pseudo-terminal                | [references/feature-terminal-driver.md](references/feature-terminal-driver.md) |
| core            | Run the app, keep each run and its evidence, and report each verdict | [references/feature-core.md](references/feature-core.md)                       |
| cli             | Parse the command line and print each envelope                       | [references/feature-cli.md](references/feature-cli.md)                         |
| guide           | Print the guide for adding a verify CLI, or one of its topics        | [references/feature-guide.md](references/feature-guide.md)                     |

<!-- /wringer:features -->

## Check a change

1. Run `bun verify report`. A feature in `data.report.features` shows `changed: true` when a file
   under its `paths` or under a `.shared` glob differs from the default branch.
2. Run `bun verify use --target local`, `bun verify up` and `bun verify doctor`. Expect: `doctor`
   returns `data.passed: true`. Run every journey on `local`: each one writes, and the read-only
   `demo` target refuses writes.
3. Run the journey from the feature's file. Expect: each command exits 0, unless the file says one
   fails.
4. Compare the app with the feature's end state:
   - When it matches, go on to step 5.
   - When your change broke the feature, fix the package, run `bun verify up --restart` and
     `bun verify doctor`, and run the journey again.
   - When your change means to change the end state, fix the feature's file, and run the journey
     again.
   - Otherwise skip `done`, and list the feature in your reply with the end state you expected and
     the `data` you got.
5. Run `bun verify done`. Expect: `ok: true`.
6. Repeat steps 3 to 5 for each changed feature. An edit to a file under a feature's `paths` after
   `done` makes its verdict `stale`, so repeat them for it.
7. Run `bun verify report --human` to read the report. Expect: `verified` on each changed feature.
8. Run `bun verify publish`. Expect: `ok: true`, and `data.action` of `created`, `replaced` or
   `unchanged`. It writes the report into the description of the branch's open PR.
9. Run `bun verify down`.

## Read the envelope

Each command prints one JSON envelope as its last line, or text with `--human`. Read `ok`, then
`data` on success, or `error.code` and `error.hint` on failure.

- `check-failed`: read the evidence. When `done` failed, run the journey again.
- `usage`: fix the command; `--help` shows its flags.
- `read-only`: leave the write undone, skip `done`, and list the write in your reply.
- `doctor-required` or `not-running`: run the commands in `error.hint`, then the journey.
- `environment`: fix the problem on this machine, such as a missing browser, and retry.
- `internal`: report the command and `error.message`. The CLI has a bug.
- `timeout`: retry once with `--timeout-ms` set to twice the `durationMs` of the envelope that timed
  out, and report a second timeout.

## Commands

Run `bun verify --help` for the list, and `bun verify <group> --help` for a group.

<!-- repo: commands -->

- `bun verify action place-order` places one order and returns its `id`.
- `bun verify orders count` counts the orders, in `data.orders`.

<!-- /repo -->

## Update a feature file

<!-- repo: registry -->

The registry,
[`create-wringer-registry.ts`](../../../packages/shop-example/src/create-wringer-registry.ts),
declares each feature's `paths`, the `.shared` globs and the `.ignore` globs. `done` refuses a
feature until a command that touches the app passes, or one the feature lists in its `commands`. So
when a feature's journey never touches the app, list its commands there. CI runs only
`bun verify lint`, so run each journey yourself. When you edit this skill or a feature file, follow
the skill steps in [AGENTS.md](../../../AGENTS.md), and give their proof in the PR.

<!-- /repo -->

- When your change alters a feature's end state on purpose, update its feature file in the same PR.
- A feature file needs `## Journey`, whose first `bash` line is `bun verify use --feature <name>`,
  and `## End state`.
- Replace the table between the `wringer:features` markers with `bun verify features --markdown`.
- Make each changed file match a feature's `paths`, a `.shared` glob or an `.ignore` glob.
- Then run `bun verify lint`, and fix each failure. When it fails with check `template`, run
  `bun verify guide maintain`.

**Reply:** the PR link that `bun verify publish` returned in `data.pr.url`, and each feature you
could not verify, with the command that failed and its `error.code`, or the end state you expected
and the `data` you got.
