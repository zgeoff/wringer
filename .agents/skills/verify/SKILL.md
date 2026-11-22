---
name: verify
description:
  'Checks a change to a wringer package by running its feature through the real verify CLI against
  the shop example app with `bun verify`, and records the verdict. Load it before you check a change
  to a `@wringer/*` package, run a feature journey, or put the verdicts in a PR.'
metadata:
  wringer-template: 'sha256:c276ebe8d896'
  wringer-command: bun verify
---

# Verify wringer

Use `bun verify` to start the shop example app, drive each feature your change touches through the
real CLI, and record a verdict. Put the report in the PR with step 10 of
[Check a change](#check-a-change), and hand back the PR link and each feature you could not verify.
When a blocker stops you before `publish`, hand back the blocker.

## Key rules

- [Check a change](#check-a-change): for each changed feature, run its journey, check the end state,
  then `done`; then push and publish with the upload token read in a subshell.
- [Read the envelope](#read-the-envelope): branch on `error.code`.
- [Commands](#commands): `bun verify --help` lists every command.
- [Edit the skill and the registry](#edit-the-skill-and-the-registry): fix a feature's file in the
  PR that changes the feature's end state, and make each changed file match a registry glob.

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
| mcp-driver      | Call the shop's MCP tools to list and place orders                   | [references/feature-mcp-driver.md](references/feature-mcp-driver.md)           |
| core            | Run the app, keep each run and its evidence, and report each verdict | [references/feature-core.md](references/feature-core.md)                       |
| cli             | Parse the command line and print each envelope                       | [references/feature-cli.md](references/feature-cli.md)                         |
| guide           | Print the guide for adding a verify CLI, or one of its topics        | [references/feature-guide.md](references/feature-guide.md)                     |

<!-- /wringer:features -->

## Check a change

1. Run `bun verify report`. A feature in `data.report.features` shows `changed: true` when a file
   that matches its `paths` or a `.shared` glob differs from the default branch. The
   [registry](#edit-the-skill-and-the-registry) holds each feature's `paths`, the file globs it
   owns, and the `.shared` globs, which mark every feature changed.
2. Run `bun verify use --target local`, `bun verify up` and `bun verify doctor`. Expect: `doctor`
   returns `data.passed: true`. `up` starts a run, which lasts until `down`. Run every journey on
   `local`: most journeys write, and the read-only `demo` target refuses writes. `use` saves the
   target in this worktree's `.wringer/` folder, so it holds in a new shell or session.
3. Run the journey from the feature's file. Expect: each command exits 0, unless the file says one
   fails.
4. Compare the app with the feature's end state:
   - When it matches, go on to step 5.
   - When your change broke the feature, fix the package, run `bun verify up --restart` and
     `bun verify doctor`, and run the journey again.
   - When your change means to change the end state, fix the feature's file, and run the journey
     again.
   - In any other case, such as a bug your change did not cause, skip `done`. List the feature in
     your reply with the end state you expected and the `data` you got.
5. Once the end state matches in step 4, run `bun verify done`. `done` never reads the end state. It
   checks only that a journey command succeeded and counts for the feature, as
   [Edit the skill and the registry](#edit-the-skill-and-the-registry) says. Expect: `ok: true`.
6. Repeat steps 3 to 5 for each changed feature. An edit to a file that matches a feature's `paths`
   after `done` makes its verdict `stale`: run `bun verify up --restart` and `bun verify doctor`,
   then repeat steps 3 to 5 for it.
7. Run `bun verify report --human` to read the report. Expect: `verified` on each changed feature.
8. Push the branch. When no PR is open for it, open one: without an open PR, `publish` fails and
   writes nothing.
9. Check that `CLOUD_FILES_URL` and `CLOUD_FILES_TOKEN_REF` are set. When either is empty, stop and
   report it as a blocker. `CLOUD_FILES_URL` is the file host that takes the evidence files.
   `CLOUD_FILES_TOKEN_REF` is the 1Password `op://` reference to the upload token. Never run
   `op read` on its own: it prints the token.
10. Publish the report. Read the token in a subshell, so it never sits in your shell. Because `&&`
    joins them, a failed `op read` stops the command before `publish` runs:

    ```bash
    (CLOUD_FILES_TOKEN="$(op read "$CLOUD_FILES_TOKEN_REF")" && export CLOUD_FILES_TOKEN && bun verify publish)
    ```

    To write to a PR other than the branch's own, add `--pr <number>`. When `op read` fails, stop
    and report it as a blocker. Expect: `ok: true`, and `data.action` of `created`, `replaced` or
    `unchanged`. `publish` writes the report into the PR's description. The CI verify gate reads
    only that description, so it never sees a verdict you did not publish.

11. Run `bun verify down`.

## Read the envelope

Each command prints one JSON envelope as its last line, or text with `--human`. Read `ok`, then
`data` on success, or `error.code` and `error.hint` on failure. When the feature's file expects a
command to fail, check its envelope against the end state, and skip the list below.

- `check-failed`: read the files the envelope lists in `evidence`. When `done` failed, run the
  journey again.
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

## Edit the skill and the registry

<!-- repo: registry -->

Each feature's `paths`, the `.shared` globs and the `.ignore` globs live in the registry,
[`create-wringer-registry.ts`](../../../packages/shop-example/src/create-wringer-registry.ts).
`done` records a verdict only after a journey command passes that touches the app or that the
feature names in its `commands` field. So when a feature's journey never touches the app, name the
journey's commands in that field. CI runs `bun verify lint` and the gate, but no journey, so run
each journey yourself. When you edit this skill or a feature file, follow the skill steps in
[AGENTS.md](../../../AGENTS.md), and give their proof in the PR.

<!-- /repo -->

- When your change alters a feature's end state on purpose, fix the feature's file in the same PR.
- A feature file needs `## Journey`, whose first `bash` line is `bun verify use --feature <name>`,
  and `## End state`.
- Replace the table between the `wringer:features` markers with `bun verify features --markdown`.
- Make each changed file match a feature's `paths`, a `.shared` glob or an `.ignore` glob.
- Then run `bun verify lint`, and fix each failure. When it fails with check `template`, run
  `bun verify guide maintain`.

**Reply:** the PR link that `bun verify publish` returned in `data.pr.url`, or the blocker that
stopped you before `publish`, and each feature you could not verify, with the command that failed
and its `error.code`, or the end state you expected and the `data` you got.
