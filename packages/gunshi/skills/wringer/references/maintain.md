# Maintain

Wire `bun verify lint` and the gate into the repo's CI, fix a journey when its feature changes, and
upgrade the `verify` skill when `lint` reports an older template.

The mistakes that cost the most:

- **A shallow checkout.** The gate needs the merge base with the PR's base branch, so it fails on a
  checkout without the full history.
- **No run on a body edit.** The gate reads the report from the PR body, so a run that skips the
  `edited` event misses the report an author pastes later.
- **Two copies of this skill.** `cp -R` into a folder that exists nests the copy inside it. Remove
  the old copy first.

## Wire the checks into CI

`bun verify lint` and `bun verify gate --base <ref> --body-file <file>` need no running app, so they
run in any job that has the repo's dependencies. The gate maps the PR's changed files to features
through `paths`, reads the last report block in the body, and works out the code's fingerprint
itself. It fails with exit code 1 when a changed feature has no verdict, or a verdict for other
code.

Add a job like this one to the repo's pull request workflow. Pin the actions as the repo's other
workflows do.

```yaml
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

Trigger it on `pull_request` with the types `opened`, `synchronize`, `reopened` and `edited`. When
the workflow holds slow jobs, put this job in a workflow of its own, so a body edit reruns only it.

## Fix a drifted journey

When a change to a feature breaks its journey, such as a renamed button, fix the journey in the
`verify` skill in the same PR. Then run the loop of the `verify` skill for that feature, and replace
the report in the PR body with the new output of `bun verify report --human`.

## Upgrade the template

When `lint` reports that the skill follows an older template:

1. Install this skill again, as [Install the skill](../SKILL.md#install-the-skill) shows.
2. Move the repo's `verify` skill out of `.claude/skills/`, such as to a git-ignored folder, so it
   doesn't load as a second skill.
3. Copy `.claude/skills/wringer/template/verify/` to the repo's skill folder.
4. Copy the frontmatter's `name`, `description` and `metadata.wringer-command`, the `#` title, and
   each `<!-- repo -->` block, from the old skill into the new one. When the new template renames or
   adds a block, fill it from the old skill's matching content.
5. Read the release notes of `@wringer/gunshi` on the wringer GitHub releases page, and apply what
   they ask of the repo parts and of the two `scripts/verify/` files.
6. Run `bun verify lint`. Expect: `ok: true`. Then delete the old skill.
