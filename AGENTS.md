# Agent Guidelines

This repo is wringer, a verification framework that each repo wraps in its own CLI. It publishes the
`@wringer/*` packages to npm.

## Required reading

The rules a task needs are not repeated here. Load the skill for the work before starting it.

| Skill           | Load before                                                                        |
| --------------- | ---------------------------------------------------------------------------------- |
| `docs-writing`  | writing or editing any committed prose: READMEs, this file                         |
| `code-style`    | writing, reviewing, or renaming any TypeScript — the shared function-verb taxonomy |
| `testing`       | designing, writing, or reviewing tests                                             |
| `skill-writing` | writing or editing a skill under `.claude/skills/`                                 |
| `ci-design`     | adding, changing, or reviewing a workflow, a job, or a trigger                     |

## Operations

- Every change reaches `main` through a pull request, and the pull request merges only once CI
  passes. Work on a branch, push the branch, and open a pull request with the repo's template.
- Use [Conventional Commits](https://www.conventionalcommits.org/) for all commit messages, with a
  lowercase header of at most 72 characters.
- Commit subjects use the imperative mood ("add X", never "added X" or a bare noun phrase).
- Commit messages carry no attribution lines: no co-author trailers and no generator notes.

## Repo structure

wringer is one Bun workspace, and the README's [Layout](README.md#layout) gives each top-level
folder's role.

repo-sync delivers the shared skills, the skill-gate hook, the pull-request workflow, the pre-push
baseline and the scripts it runs from zgeoff/tools, and overwrites a local edit. `review.json` lists
those paths. Change one of them in zgeoff/tools.

## Packages

- Each package takes the name `@wringer/<folder>`. Its `exports` map points `types` at the emitted
  `dist/index.d.ts` and `default` at `src/index.ts`, so Bun runs the source.
- Every external version lives once, in the root `workspaces.catalog`. A package writes `"catalog:"`
  for an external dependency and `"workspace:*"` for an internal one.
- The root `package.json` declares only tooling.
- Pin exact versions, with no `^` or `~` ranges.

## Public repo

The repo is public, and everything pushed to it stays public. Keep your own environment out of it,
so your setup never leaks through your work.

- Leave out home directory paths, host names, private network names, cloud details, and the names of
  the tools and agents you work with.
- Leave out any one user's name, rules, repos and evidence.

Before you commit, grep the diff for `sk-ant`, `GOCSPX`, `AGE-SECRET-KEY`, `ops_`, `/home/` and
`.ts.net`.

## Toolchain

- Bun is pinned in `.bun-version`. `bun run format` fixes formatting, and `bun run check` runs every
  check that CI runs.
- CI runs the shared Bun pull-request workflow from zgeoff/tools on each pull request. The
  `BUN_CHECK_SCRIPTS` repo variable holds its script list:
  `audit deadcode format:check lint:full typecheck prose test`. A change to that list changes
  `bun run check` in the same commit.
- `bun run typecheck` runs `tsrs` over the root and each package. A package's `build` script emits
  its declarations with `tsrs`.
- `lint:full` adds the type-aware rules and fails on an unused disable directive. oxlint runs the
  type-aware rules through tsrslint (`@maschwenk/tsrslint`), a Rust port of tsgolint, in tsgolint's
  place, because stock tsgolint runs out of memory under 2 GiB. `lint:full` runs in CI and in
  `bun run check`, never in a git hook.
- lefthook runs oxlint, oxfmt, format-codemod and gitleaks before a commit, and commitlint on the
  message. Before a push it runs the prose check, then the shared pre-push baseline: the format
  check and typecheck over the whole tree, and lint and the tests over what the branch changes.
