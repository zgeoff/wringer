# Maintain

- `bun verify gate --base <ref> --body-file <file>` maps the PR's changed files to features through
  `paths`, reads the report block in the PR body, and works out the fingerprint itself. It fails
  with exit code 1 when a changed feature has no verdict, or a verdict for other code.
- The gate needs the merge base, so the CI checkout needs the full history.
- An edit to the PR body changes what the gate reads, so run the gate on the `edited` event too.
- `bun verify lint` needs no running app and no run, so it runs in any CI job that has the repo's
  dependencies.

## Wire the checks into CI

Add a job like this one to the repo's pull request workflow, adapted to its setup:

```yaml
verify:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
      with:
        fetch-depth: 0
    - uses: oven-sh/setup-bun@v2
    - run: bun install --frozen-lockfile
    - run: bun verify lint
    - run: jq -r '.pull_request.body // ""' "$GITHUB_EVENT_PATH" > "$RUNNER_TEMP/pr-body.md"
    - run: bun verify gate --base "origin/$GITHUB_BASE_REF" --body-file "$RUNNER_TEMP/pr-body.md"
```

Trigger the workflow on `pull_request` with the types `opened`, `synchronize`, `reopened` and
`edited`.

## Fix a drifted journey

When a change to a feature breaks its journey, such as a renamed button, fix the journey in the
`verify` skill in the same PR. Then drive the feature again, run `done`, and paste the new
`report --human` in the PR body.

## Upgrade the template

When `lint` reports that the skill follows an older template:

1. Copy the build skill again from `node_modules/@wringer/gunshi/skills/wringer`.
2. Copy its `template/verify/SKILL.md` over the repo's `verify` skill, keeping a copy of the old
   one.
3. Copy the frontmatter's `name`, `description` and `metadata.wringer-command`, and each
   `<!-- repo -->` block, from the old skill into the new one.
4. Read the `@wringer/gunshi` changelog for the template's changes, and apply any it asks of the
   repo parts.
5. Run `bun verify lint`. Expect: `ok: true`.
