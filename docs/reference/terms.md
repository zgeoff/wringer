# Terms

Each term that wringer's docs use is defined here, and only here. Other docs link a term to its
entry. The entries run from what a repo writes, through what an agent does, to what a reviewer
reads.

## Registry

A repo's declaration of what wringer needs to know about it: its targets, drivers, actions,
commands, doctor checks, features, shared globs, ignore list, and the secrets the CLI redacts. The
repo builds it with `createWringer` from `@wringer/core`, and `runVerify` from `@wringer/gunshi`
turns it into the repo's verify CLI, which an agent runs as `bun verify <command>`. Each registry
has a name, which the report records.

## Target

A place where the app runs. The verify CLI starts a launch target, such as `local`, and reaches an
attach target, such as a deployed instance, without starting it. The repo marks each target
`read-write` or `read-only` in the registry. On a read-only target, the CLI refuses each write with
the `read-only` error.

## Driver

A package that adds a group of commands for one way to use the app, such as `@wringer/http` and its
`http request`. A driver reaches the app through the target the run uses. Some drivers also run a
service for the length of a run, such as the one that records the app's logs.

## Action

A setup step that the repo writes, such as seeding a record, which an agent runs as
`bun verify action <name>`. Each action declares its effect, `read` or `write`.

## Command

Any verify CLI command. wringer builds in the lifecycle and verdict commands, such as `up`,
`doctor`, `done`, `report` and `gate`. Drivers and the repo add the rest. Each command that a driver
or the repo adds declares its effect, `read` or `write`. A command that declares none is a write.

## Feature

A named part of the repo that has its own verdict. It has a summary and `paths`, the globs of the
files whose change can alter its behaviour.

## Journey

The commands that use one feature, and the end state that shows it works. The repo's `verify` skill,
which tells an agent how to drive the app, gives one journey for each feature.

## Run

One supervised session on one target. On a launch target, `bun verify up` starts a run and
`bun verify down` ends it. One supervisor process owns the app and every driver service, and writes
the run's events to the run's log. On an attach target, `bun verify attach` starts a run and
`bun verify detach` ends it. The app stays outside the supervisor, which owns only the driver
services.

## Doctor

The checks that a run passes before the CLI lets any command touch the app. `bun verify doctor` runs
them. Until they pass, the CLI refuses such a command with `doctor-required`.

## Verdict

The record that `bun verify done` writes: a feature works at its current fingerprint, on one target.
A verdict is stale once its feature's fingerprint changes. An attach target can report the commit it
runs. A verdict on such a target is pinned: `done` records it only when that commit holds the same
code as the worktree in the feature's files. A verdict on any other target is unpinned.

## Fingerprint

A hash of the diff against the merge base with the PR's base branch, limited to one feature's
`paths` and the shared globs, with the ignore list left out. The same change gives the same
fingerprint in any clone, and an edit to another feature's files leaves it as it was.

## Evidence

The files and data that a run's commands keep as proof, such as a screenshot or a response body. The
repo sets for each target in the registry whether the CLI keeps the evidence local or uploads it.
The report links to uploaded evidence.

## Report

The block in a PR description that lists each changed feature with its status and, for a verified
feature, its journey and its evidence. `bun verify report --human` prints it, and the agent puts it
in the PR description. The block ends with an HTML comment that holds each verdict's data, and the
gate reads the verdicts from that comment.

## Gate

The check that CI runs on each PR. `bun verify gate` fails a PR in each of these cases:

- A changed feature has no verdict in the report at its current fingerprint.
- A changed path matches no feature's `paths`, no shared glob and nothing in the ignore list.
- The registry's gate policy, `.gate({ unpinned: 'refuse' })`, refuses unpinned verdicts, and a
  changed feature has only an unpinned verdict.

## Shared glob

A glob of files that change every feature's behaviour, such as a lock file. A change to a file that
a shared glob matches changes every feature's fingerprint. The repo lists them with `.shared()` in
the registry.

## Ignore list

The globs of the files the running app never reads, such as docs and tests. A path that an ignore
glob matches counts as no change: the gate skips it, and the CLI leaves it out of every fingerprint.
The repo lists them with `.ignore()` in the registry.
