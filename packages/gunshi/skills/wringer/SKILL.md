---
name: wringer
description:
  "Builds a repo's verify CLI, feature map and verify skill on wringer, proves them, and keeps them
  true. Load it to add wringer to a repo, to prove a verify CLI before its PR, when `verify lint`
  fails, or when a new @wringer/gunshi ships a new template version."
---

# Build a verify CLI with wringer

Give the repo's agents one way to drive its real app and keep the evidence of what they checked.
Build three things in the repo: a verify CLI on the `@wringer/*` packages, a feature map in its
registry, and a `verify` skill that tells the repo's agents how to drive each feature. Then prove
all three, and wire the checks that keep them true.

Hand back the PR that adds them, with the proof in its description. The mistakes that cost the most:

- **Calling it done before a fresh agent uses it.** You know the app. The repo's next agent knows
  only the `verify` skill, so only a subagent with none of your context shows that the skill works.
- **Copying commands into the verify skill.** The CLI lists its own commands in `--help`, and a copy
  goes stale. Point at `--help`, and write only what the help can't say.
- **A `paths` glob that matches nothing.** The gate maps a PR's changed files to features through
  `paths`. A dead glob means no change ever asks for that feature's verdict. `lint` catches it.
- **Writing the repo's own setup into the template's fixed parts.** Put a repo choice, such as a
  refusal route or an upload hook, in the repo's code and in the skill's `<!-- repo -->` blocks.

## Key rules

- [Install the skill](#install-the-skill): copy it from `@wringer/gunshi`, at the version the repo
  pins.
- [The template](#the-template): three files to copy, with fixed parts and repo parts.
- [Create](#create): read the repo, then write the CLI, the actions, the checks, 3 to 5 features and
  the `verify` skill.
- [Prove](#prove): doctor passes, a fresh subagent reaches `done` on every feature, and the CLI
  refuses what it should.
- [Maintain](#maintain): the gate on each PR, `lint` in CI, and a template upgrade when `lint` asks.

## References

- [Create](./references/create.md): writing the CLI, the registry and the `verify` skill in a repo.
- [Prove](./references/prove.md): the proof steps and what each shows in the PR.
- [Fresh subagent brief](./references/fresh-subagent-brief.md): the brief to give the subagent in
  the prove flow.
- [Maintain](./references/maintain.md): wiring the gate and `lint` into CI, and upgrading the
  template.

## Install the skill

The skill ships inside `@wringer/gunshi`, so its version matches the packages the repo installs:

```bash
bun add --dev --exact @wringer/core @wringer/gunshi
cp -R node_modules/@wringer/gunshi/skills/wringer .claude/skills/wringer
```

Copy it again after each upgrade of `@wringer/gunshi`. When the repo uses another package manager,
use it in place of `bun`, and change the script name in the template to match.

## The template

[`template/`](./template/) holds a working example for an invented app, Larder:

| File                                                  | Copy to                             | Holds                                                       |
| ----------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------- |
| [`verify.ts`](./template/verify.ts)                   | `scripts/verify/verify.ts`          | the entry point that calls `runVerify`                      |
| [`verify-registry.ts`](./template/verify-registry.ts) | `scripts/verify/verify-registry.ts` | targets, a driver, an action, a command, a check, a feature |
| [`verify/SKILL.md`](./template/verify/SKILL.md)       | `.claude/skills/verify/SKILL.md`    | the repo's `verify` skill                                   |

The folder `scripts/verify/`, the skill folder and the script name `verify` are defaults. Change
them together:

- `runVerify`'s `skill` option holds the path of the skill folder.
- The skill's `metadata.wringer-command` holds the command that calls the CLI, such as `bun verify`.

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
2. A fresh subagent that loads only the new `verify` skill reaches `done` on every feature.
3. A drive after an edit to the tree fails with `doctor-required`. A read-only target, if the repo
   has one, refuses one write with `read-only`.
4. The output of `bun verify report --human` is in the description of the PR that adds the CLI.

## Maintain

Wire these into the repo, as [Maintain](./references/maintain.md) shows:

- **The gate on each PR.** CI runs `bun verify gate`, so a PR that touches a feature's `paths` needs
  a verdict for its current code. When a journey drifts because its feature changed, the PR's author
  fixes the journey in the same PR.
- **`lint` in CI.** It needs no running app.
- **One manual pass when you first make a map.** The fresh subagent run in the prove flow is that
  pass.

Add no scheduled job. The gate checks a feature each time a PR changes it.

**Reply:** the PR link, and for each prove step, the command and the output lines that show it held.
