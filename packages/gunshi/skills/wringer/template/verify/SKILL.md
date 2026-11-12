---
name: verify
description:
  'Uses the Larder app the way a user would with `bun verify`, and records the verdict that a
  feature works. Load it before you check a change in the running app, run a journey from the
  feature map, or put the verdicts in a PR.'
metadata:
  wringer-template: 1
  wringer-command: bun verify
---

# Verify Larder

Use `bun verify` to start the app, use each feature your change touches the way a user would, and
record a verdict that it works. Hand back the output of `bun verify report --human` and each feature
you could not verify. The CI gate, `bun verify gate`, fails a PR that changes a feature with no
verdict.

Each feature in the [feature map](./references/feature-map.md) has a journey: the `bun verify`
commands that use the feature, and the end state that shows it works.

The mistakes that cost the most time:

- **Using the app before `doctor` passes.** `bun verify doctor` checks that the app answers and that
  each driver works. Until it passes on the current run, the one that `up` or `attach` started, any
  command that touches the app fails with exit code 3.
- **Editing the app's code while `up` runs it.** The next command that touches the app fails with
  `doctor-required`. Run `bun verify up --restart`, then `bun verify doctor`. Then run the feature's
  journey again.
- **Running `done` before you check the end state.** `done` checks only that one command of the
  feature's journey after `use --feature`, a read or a write, succeeded. It does not check the
  result. Check the end state yourself first.
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

- [Feature map](./references/feature-map.md): each feature's journey and end state, before you check
  the feature.

## Check a change

1. Run `bun verify report`. Each feature in `data.report.features` with `changed: true` has a file
   under its `paths` that differs from the default branch, committed or not. Each one needs a
   verdict.
2. Unless your task names another target, start a run on `local`, with the commands in the
   [Targets](#targets) table. Expect: `ok: true`, and the app's endpoints in `data.endpoints`.
3. Run `bun verify doctor`. Expect: `data.passed: true`. When a check fails, fix its cause, and run
   `doctor` again.
4. Run the feature's journey from the [feature map](./references/feature-map.md). Its first line,
   `use --feature`, records each later command under that feature. It does not change the target.
   Expect: each command exits 0.
5. Compare the app with the feature's end state:
   - When it matches, and no command failed with `read-only`, go on to step 6.
   - When your change broke the feature, fix the app's code. Then run `bun verify up --restart`,
     `bun verify doctor` and the journey again.
   - When your change means to change the end state, fix the feature's entry in the feature map, and
     run `bun verify lint`. Then run the journey again.
   - Otherwise, skip `done` for this feature. List it in your reply with the end state you expected
     and the `data` you got.
6. Run `bun verify done`. It records a verdict for the feature that `use --feature` set. Expect:
   `ok: true`. It fails with exit code 1 and `check-failed` until one command of the journey
   succeeds after `use --feature` and `doctor`.
7. Repeat steps 4 to 6 for each feature with `changed: true`, and for each feature your task names,
   in the order the feature map lists them. When the feature map's opening names a journey to run
   last, follow it. When a changed feature has no entry in the feature map, write one, and run
   `bun verify lint`.
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

| Target   | Start with                                                 | Access     | Notes                                                  |
| -------- | ---------------------------------------------------------- | ---------- | ------------------------------------------------------ |
| `local`  | `bun verify use --target local`, then `bun verify up`      | read-write | Starts the app with `bun run dev`.                     |
| `shared` | `bun verify use --target shared`, then `bun verify attach` | read-only  | An app that `bun verify` did not start. Never stop it. |

<!-- /repo -->

## Commands

Run `bun verify --help` for the list, and `bun verify <command> --help` for a command's flags. The
help marks each command `[read]` or `[write]`.

- Run `bun verify <group> --help` to list the commands in a group, such as `action`. The top-level
  list shows the group alone.
- Write a negative number with `=`, as in `--offset=-5`.
- Pass an object as JSON text, as in `--filter '{"shelf":"top"}'`.

<!-- repo: commands -->

- `bun verify action add-item --name <name>` adds an item through the API.
- `bun verify items count` counts the items through the API, in `data.count`.

<!-- /repo -->

## Feature map

Before you run a feature's journey, read its entry in the
[feature map](./references/feature-map.md): what it does, how a user reaches it, its journey and its
end state. `bun verify features` lists each feature's `paths`. The gate needs a verdict for each
feature whose `paths` match a changed file. It fails on a changed file that matches neither `paths`
nor `.ignore` in the registry: add the file to one of them.

## Update the feature map

<!-- repo: registry -->

The registry, `scripts/verify/verify-registry.ts`, declares the targets, actions, commands, doctor
checks and features, with each feature's `paths`.

<!-- /repo -->

- When a feature's journey stops working because the feature changed, fix it in the same PR.
- In this file, edit only the frontmatter's `name` and `description`, the `#` title, and the lines
  inside the `<!-- repo -->` blocks. An upgrade of the template keeps those and replaces every other
  line. You may edit any line of the feature map.
- After you change this skill, its feature map or the registry, run `bun verify lint`. It fails on:
  - a `paths` glob that matches no file;
  - a command in a code block that would fail before it ran, such as one with an unknown flag,
    feature or target;
  - a skill written from an older template. Load the `wringer` skill that `@wringer/gunshi` ships,
    and follow its upgrade steps.

**Reply:** the output of `bun verify report --human`, and each feature you could not verify, with
the command that failed and its `error.code`, or the end state you expected and the `data` you got.
