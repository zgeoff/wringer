# Maintain

Wire `bun verify lint` and the gate into the repo's CI, fix a journey when its feature changes, and
upgrade the `verify` skill when `lint` reports an older template.

The mistakes that cost the most:

- **A shallow checkout.** The gate needs the merge base with the PR's base branch, so it fails on a
  checkout without the full history.
- **No run on a body edit.** The gate reads the report from the PR body, so a run that skips the
  `edited` event misses the report an author pastes later.
- **A nested copy.** `cp -R` into a folder that exists nests the copy inside it. Move the old
  `verify` skill folder away first, as step 2 of the upgrade does. The installer replaces the
  wringer skill's folder itself.

## Wire the checks into CI

`bun verify lint` and `bun verify gate --base <ref> --body-file <file>` need no running app, so they
run in any job that has the repo's dependencies. The gate maps the PR's changed files to features
through `paths`, reads the last report block in the body, and works out the code's fingerprint
itself. It fails with exit code 1 when a changed feature has no verdict, or a verdict for other
code.

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

A journey breaks when a change to its feature, such as a renamed button, makes a journey command
fail or its end state no longer match. Fix the feature's journey in the `verify` skill's
`references/feature-map.md`, in the same PR. Then follow the `verify` skill's "Check a change" for
that feature. Replace the whole report in the PR body with the new output of
`bun verify report --human`.

## Upgrade the template

When `lint` reports that the skill follows an older template:

1. Run `bunx @wringer/gunshi skill install`, as [Install the skill](../SKILL.md#install-the-skill)
   shows. It replaces the repo's copy of the wringer skill.
2. Move the repo's `verify` skill folder, such as `.claude/skills/verify/`, to a folder outside
   `.claude/skills/`, so it doesn't load as a second skill. List that folder in `.git/info/exclude`,
   so git ignores it without a change to `.gitignore`.
3. Copy `.claude/skills/wringer/template/verify/` to the folder that `runVerify`'s `skill` option
   names, which no longer exists.
4. Copy the old skill's `references/feature-map.md` over the template's. Copy the frontmatter's
   `name`, `description` and `metadata.wringer-command`, the `#` title, and each `<!-- repo -->`
   block, from the old `SKILL.md` into the new one. When the new template renames or adds a block,
   fill it from the old skill's matching content.
5. Read the release notes of each `@wringer/gunshi` version since the old one on
   <https://github.com/zgeoff/wringer/releases>. Apply what they ask of the `<!-- repo -->` blocks,
   `verify.ts` and the registry.
6. Run `bun verify lint`. Expect: `ok: true`. Then delete the old skill.
