---
name: wringer
description:
  "Builds a repo's verify CLI, feature map and verify skill on wringer, proves them, and keeps them
  true. Load it to add wringer to a repo, to prove a verify CLI before its PR, when `verify lint`
  fails, or when a new @wringer/gunshi ships a new template version."
---

# Build a verify CLI with wringer

Give the repo's agents one way to use its real app and keep the evidence of what they checked. Build
these in the repo:

- a verify CLI on the `@wringer/*` packages, which an agent runs as `bun verify <command>`;
- its registry: the code that declares the targets, the drivers, the actions, the doctor checks and
  the features, with each feature's `paths` globs, and the ignore list: the globs, set with
  `.ignore`, of the files the running app never reads;
- a `verify` skill, with a feature map in its `references/feature-map.md` that gives each feature's
  journey.

These terms hold across this skill and its references:

| Term      | Meaning                                                                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| target    | where the app runs: `local`, which the CLI starts, or an instance it attaches to                                                                          |
| read-only | a target's access that refuses each write with exit code 3                                                                                                |
| driver    | a package that adds a group of commands, such as `@wringer/http` and `http request`                                                                       |
| action    | a named step of the repo's own, run as `bun verify action <name>`                                                                                         |
| doctor    | `bun verify doctor`: the checks that must pass before any command that touches the app                                                                    |
| journey   | the `bun verify` commands that use one feature, and the end state that shows it works                                                                     |
| verdict   | what `bun verify done` records: the feature works on the current code                                                                                     |
| gate      | `bun verify gate` in CI: it fails a PR with a changed feature that lacks a verdict, or a changed file outside every feature's `paths` and the ignore list |
| report    | the output of `bun verify report --human`, which the PR body holds for the gate                                                                           |

Then prove them, and wire the checks that keep them true. Hand back the PR that adds them, with the
proof in its description. The mistakes that cost the most:

- **Calling it done before a fresh agent uses it.** You know the app; the repo's next agent knows
  only the `verify` skill. Run a subagent with none of your context to show that the skill works.
- **Copying commands into the `verify` skill.** The CLI lists its own commands in `--help`, and a
  copy goes stale. Point at `--help`, and write only what the help can't say.
- **A `paths` glob that matches no file.** The files it should cover then fail the gate as unmapped,
  unless another feature's glob covers them. Run `bun verify lint` to find one.
- **Writing a repo's own choices outside the `<!-- repo -->` blocks of the `verify` skill.** An
  upgrade of the template replaces every line outside them. Put each choice, such as where an agent
  reports a refused write, in a block or in the repo's code.

## Key rules

- [Install the skill](#install-the-skill): copy it from `@wringer/gunshi`, at the version the repo
  installs.
- [The template](#the-template): the files to copy, with fixed parts and repo parts.
- [Create](#create): read the repo, then write the CLI, the actions, the checks, 3 to 5 features,
  the ignore list and the `verify` skill.
- [Prove](#prove): doctor passes, a fresh subagent reaches `done` on every feature, and the CLI
  refuses what it should.
- [Maintain](#maintain): the gate and `lint` in CI, and a template upgrade when `lint` asks.

## References

- [Create](./references/create.md): writing the CLI, the registry and the `verify` skill in a repo.
- [Prove](./references/prove.md): the proof steps and what each shows in the PR.
- [Fresh subagent brief](./references/fresh-subagent-brief.md): the brief to give the subagent in
  the prove flow.
- [Maintain](./references/maintain.md): wiring the gate and `lint` into CI, and upgrading the
  template.

## Install the skill

This skill ships inside `@wringer/gunshi`, so its version matches the packages the repo installs.
These commands put it in `.claude/skills/wringer/`, where an agent can load it, and replace any
older copy there. Commit that folder with the rest of the work:

```bash
bun add --dev --exact @wringer/core @wringer/gunshi zod
bunx @wringer/gunshi skill install
```

Run the second command again after each upgrade of `@wringer/gunshi`.

The CLI runs on Bun. When the repo installs packages with another package manager, use it for
`bun add` and `bunx`, such as `pnpm add` and `pnpm dlx`. Also use it in the `verify` skill's
`metadata.wringer-command`, such as `pnpm verify`. The `verify` script in `package.json` still runs
the CLI with `bun`.

## The template

[`template/`](./template/) holds a working example for an invented app, Larder:

| File                                                  | Copy to                             | Holds                                                           |
| ----------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------- |
| [`verify.ts`](./template/verify.ts)                   | `scripts/verify/verify.ts`          | the entry point that calls `runVerify`                          |
| [`verify-registry.ts`](./template/verify-registry.ts) | `scripts/verify/verify-registry.ts` | targets, a driver, an action, a command, a check, a feature     |
| [`verify/`](./template/verify/)                       | `.claude/skills/verify/`            | the repo's `verify` skill, and its feature map in `references/` |

Skip `verify-registry.test.ts` in `template/`: it tests the template inside wringer.

These locations are defaults. When you change one, change each place that refers to it:

- the folder `scripts/verify/`: the `verify` script's path in `package.json`, and its glob in the
  registry's `.ignore` list;
- the skill folder: `runVerify`'s `skill` option, a path from the repo root;
- the script name `verify`: the `package.json` script and the skill's `metadata.wringer-command`,
  such as `bun verify`.

In the `verify` skill's `SKILL.md`, each `<!-- repo: <part> -->` block ends at `<!-- /repo -->` and
holds what only this repo knows. Rewrite those blocks, the frontmatter's `name` and `description`,
and the `#` title. Keep every other line. The repo owns `references/feature-map.md` whole. Keep
`metadata.wringer-template` as the template has it: `lint` compares it with the version that
`@wringer/gunshi` ships.

## Create

Read how the app starts, what it prints when it is ready, and which state it keeps. Then follow
[Create](./references/create.md): it ends with 3 to 5 features in the registry, each with a journey
in the `verify` skill, an ignore list for the files with no runtime effect, and `bun verify lint`
passing.

## Prove

The work is done only when each of these holds. [Prove](./references/prove.md) gives the commands.

1. `bun verify doctor` passes on `local`.
2. A fresh subagent that loads only the new `verify` skill reaches `done` on every feature. A new
   feature map needs one pass by an agent who did not write it, and this run is that pass.
3. After an edit to a file that a feature's `paths` match, a command that touches the app fails with
   `doctor-required`. A read-only target, if the repo has one, refuses one write with `read-only`.
4. The whole report is in the description of the PR that adds the CLI. The gate reads the report
   from the HTML comment at the report's end.

## Maintain

Wire these into the repo, as [Maintain](./references/maintain.md) shows:

- **The gate on each PR.** A PR that touches a feature's `paths` needs a verdict recorded on the
  PR's latest code. A PR that touches a file outside every feature's `paths` and the ignore list
  fails until you add the file to one of them.
- **`lint` in CI.** It needs no running app.
- **A journey fixed with its feature.** A PR that changes a feature fixes the feature's journey.

Add no scheduled job. The gate checks a feature each time a PR changes it.

**Reply:** the PR link, and for each prove step, the command and the output lines that show it held.
