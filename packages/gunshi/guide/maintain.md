# Maintain

Keep the gate, lint and the journeys true, and upgrade the verify skill

Wire `bun verify lint` and the gate into the repo's CI, fix a journey when its feature changes, and
upgrade the `verify` skill when `lint` reports an older template.

The mistakes that cost the most:

- **A shallow checkout.** The gate needs the merge base with the PR's base branch, so it fails on a
  checkout without the full history.
- **No run on a body edit.** The gate reads the report from the PR body, so a run that skips the
  `edited` event misses the report an author pastes later.
- **A nested copy.** `cp -R` into a folder that exists nests the copy inside it. Move the old
  `verify` skill folder away first, as step 2 of the upgrade does.

## Wire the checks into CI

`bun verify lint` and `bun verify gate --base <ref> --body-file <file>` need no running app, so they
run in any job that has the repo's dependencies. The gate reads the last report block in the PR body
and works out the code's fingerprint itself. It fails with exit code 1 in two cases:

- A changed feature has no verdict, or a verdict for other code in its own files or a shared path.
- A changed file matches neither a feature's `paths` nor a glob in the ignore list, which the
  registry sets with `.ignore`. `bun verify gate` lists each such file in `data.unmapped`. When the
  running app never reads the file, add it to the ignore list. Otherwise add it to a feature's
  `paths`.

Add a workflow like this one. When the repo's other workflows pin each action to a commit SHA, pin
these the same way.

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, edited]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # the gate needs the merge base
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun verify lint
      - run: jq -r '.pull_request.body // ""' "$GITHUB_EVENT_PATH" > "$RUNNER_TEMP/pr-body.md"
      - run: bun verify gate --base "origin/$GITHUB_BASE_REF" --body-file "$RUNNER_TEMP/pr-body.md"
```

Keep it a workflow of its own, so a body edit reruns only this job.

## Fix a drifted journey

A journey breaks when a change to its feature, such as a renamed button, makes a command of its
journey fail, or leaves the app different from the end state the journey expects. Fix the feature's
journey in the feature's `references/feature-<name>.md` in the `verify` skill, in the same PR. Then
follow the `verify` skill's "Check a change" for that feature. Replace the whole report in the PR
body with the new output of `bun verify report --human`.

## Upgrade the template

When `lint` reports that the skill follows an older template:

1. Run `bun verify guide template`. It names the folder of the template that the installed
   `@wringer/gunshi` ships.
2. Move the repo's `verify` skill folder, such as `.claude/skills/verify/`, to a folder outside
   `.claude/skills/`, so it doesn't load as a second skill. List that folder in `.git/info/exclude`,
   so git ignores it without a change to `.gitignore`.
3. Copy `verify/` from that template folder to the folder that `runVerify`'s `skill` option names,
   which no longer exists.
4. Delete the template's `references/feature-add-item.md`, its example feature, which fails `lint`
   unless the repo has a feature of that name. Copy the old skill's `references/feature-*.md` files
   into `references/`. Replace the feature table between the `wringer:features` markers with the
   output of `bun verify features --markdown`. Copy the frontmatter's `name`, `description` and
   `metadata.wringer-command`, the `#` title, and each `<!-- repo -->` block, from the old
   `SKILL.md` into the new one. When the new template renames or adds a block, fill it from the old
   skill's matching content.
5. Read the release notes of each `@wringer/gunshi` version since the old one on
   <https://github.com/zgeoff/wringer/releases>. Apply what they ask of the `<!-- repo -->` blocks,
   `verify.ts` and the registry.
6. Run `bun verify lint`. Expect: `ok: true`. Then delete the old skill.
