---
name: wringer
description:
  "Builds a repo's verify CLI, feature map and verify skill on wringer, proves them, and keeps them
  true. Load it to add wringer to a repo, to prove a verify CLI before its PR, when `verify lint`
  fails, or when a new @wringer/gunshi ships a new template version."
---

# Build a verify CLI with wringer

Give the repo's agents one way to drive its real app and keep the evidence of what they checked.
Build three things in the repo:

- a verify CLI on the `@wringer/*` packages, which an agent runs as `bun verify <command>`;
- its registry: the code that declares the targets the CLI runs against, the drivers, and the
  feature map, where each feature lists the `paths` globs of its files;
- a `verify` skill that gives the repo's agents the journey for each feature: the commands that
  drive it, and the end state that shows it works.

Then prove all three, and wire the checks that keep them true. `bun verify done` records a verdict
that a feature works on the current code, and the CI gate, `bun verify gate`, fails a PR that
changes a feature's files without a verdict.

Hand back the PR that adds them, with the proof in its description. The mistakes that cost the most:

- **Calling it done before a fresh agent uses it.** You know the app; the repo's next agent knows
  only the `verify` skill. Run a subagent with none of your context to show that the skill works.
- **Copying commands into the `verify` skill.** The CLI lists its own commands in `--help`, and a
  copy goes stale. Point at `--help`, and write only what the help can't say.
- **A `paths` glob that matches no file.** The gate maps a PR's changed files to features through
  `paths`, so it never asks for that feature's verdict. Run `bun verify lint` to find one.
- **Writing a repo's own choices into the template's fixed parts.** Put each one, such as where an
  agent reports a refused write, in the repo's code or in a `<!-- repo -->` block of the skill.

## Key rules

- [Install the skill](#install-the-skill): copy it from `@wringer/gunshi`, at the version the repo
  installs.
- [The template](#the-template): three files to copy, with fixed parts and repo parts.
- [Create](#create): read the repo, then write the CLI, the actions, the checks, 3 to 5 features and
  the `verify` skill.
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
Replace any older copy:

```bash
bun add --dev --exact @wringer/core @wringer/gunshi
rm -rf .claude/skills/wringer
mkdir -p .claude/skills
cp -R node_modules/@wringer/gunshi/skills/wringer .claude/skills/wringer
```

Run the last three commands again after each upgrade of `@wringer/gunshi`. When the repo uses
another package manager, use it in place of `bun` here, in the `package.json` script and in the
`verify` skill's `metadata.wringer-command`, such as `pnpm verify`.

## The template

[`template/`](./template/) holds a working example for an invented app, Larder:

| File                                                  | Copy to                             | Holds                                                       |
| ----------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------- |
| [`verify.ts`](./template/verify.ts)                   | `scripts/verify/verify.ts`          | the entry point that calls `runVerify`                      |
| [`verify-registry.ts`](./template/verify-registry.ts) | `scripts/verify/verify-registry.ts` | targets, a driver, an action, a command, a check, a feature |
| [`verify/SKILL.md`](./template/verify/SKILL.md)       | `.claude/skills/verify/SKILL.md`    | the repo's `verify` skill                                   |

The folder `scripts/verify/`, the skill folder and the script name `verify` are defaults. When you
change one, change the place that holds it:

- the skill folder: `runVerify`'s `skill` option, a path from the repo root;
- the script name: the skill's `metadata.wringer-command`, such as `bun verify`.

In the `verify` skill, each `<!-- repo: <part> -->` block ends at `<!-- /repo -->` and holds what
only this repo knows. Rewrite those blocks, and keep every line outside them. Keep
`metadata.wringer-template` as the template has it: `lint` compares it with the version that
`@wringer/gunshi` ships.

## Create

Follow [Create](./references/create.md). In short:

1. Read how the app starts, what it prints when it is ready, and which state it keeps.
2. Pick the targets and the drivers.
3. Copy the template, and write the targets, actions, repo commands and doctor checks.
4. Write 3 to 5 features, each with a journey a user takes and `paths` globs that match its files.
5. Write the `verify` skill from the template, then run `bun verify lint` until it passes.

## Prove

The work is done only when each of these holds. [Prove](./references/prove.md) gives the commands.

1. `bun verify doctor` passes on `local`.
2. A fresh subagent that loads only the new `verify` skill reaches `done` on every feature. This run
   is also the manual pass that each new feature map needs.
3. A drive after an edit to the app's code fails with `doctor-required`. A read-only target, if the
   repo has one, refuses one write with `read-only`.
4. The output of `bun verify report --human` is in the description of the PR that adds the CLI.

## Maintain

Wire these into the repo, as [Maintain](./references/maintain.md) shows:

- **The gate on each PR.** CI runs `bun verify gate`, so a PR that touches a feature's `paths` needs
  a verdict for its current code. When a journey drifts because its feature changed, the PR's author
  fixes the journey in the same PR.
- **`lint` in CI.** It needs no running app.

Add no scheduled job. The gate checks a feature each time a PR changes it.

**Reply:** the PR link, and for each prove step, the command and the output lines that show it held.
