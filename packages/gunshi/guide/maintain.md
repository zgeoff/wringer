# Maintain

Keep the gate, lint and the journeys true, and upgrade the verify skill

Wire `bun verify lint` and the gate into the repo's CI, fix a journey when its feature changes, and
upgrade the `verify` skill when `lint` reports an older template.

## Wire the checks into CI

`bun verify lint` and `bun verify gate --base <ref> --body-file <file>` need no running app, so they
run in any job that has the repo's dependencies. The gate reads the last report block in the PR body
and works out the code's fingerprint itself. It fails with exit code 1 in two cases:

- A changed feature has no verdict, or a verdict for other code in its own files or a shared path.
- A changed file is in no feature's files and matches no glob in the ignore list, which the registry
  sets with `.ignore`. `bun verify gate` lists each such file in `data.unmapped`. When the running
  app never reads the file, add it to the ignore list. Otherwise add it to a feature's `extra`, or
  import it from a file the feature's `entries` reach.

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

Keep the `edited` type: `bun verify publish` writes the report into the PR body after the push, and
the gate reads the report only from there. Keep it a workflow of its own, so a body edit reruns only
this job.

## Fix a drifted journey

A journey breaks when a change to its feature, such as a renamed button, makes a command of its
journey fail, or leaves the app different from the end state the journey expects. Fix the feature's
journey in the feature's `references/feature-<name>.md` in the `verify` skill, in the same PR. Then
follow the `verify` skill's "Check a change" for that feature. Run `bun verify publish` to replace
the report in the PR description.

## Upgrade the template

Upgrade the repo's `verify` skill when `lint` fails with check `template`. The check fails when the
skill's `metadata.wringer-template` holds a version number, or a hash other than the hash of the
installed template.

1. Run `bun verify guide template`. It names the folder of the template that the installed
   `@wringer/gunshi` ships.
2. Move the repo's `verify` skill folder to a folder outside `.claude/skills/`, so it doesn't load
   as a second skill. The skill folder is the path that the `skill` option of `runVerify` in
   `verify.ts` names, such as `.claude/skills/verify/`. List the new folder in `.git/info/exclude`,
   so git ignores it without a change to `.gitignore`.
3. Copy the template's `verify/` folder to the skill folder path, which no longer exists after
   step 2. `cp -R` into a folder that exists nests the copy inside it.
4. Delete the new skill's `references/feature-add-item.md`, the template's example feature, which
   fails `lint` unless the repo has a feature of that name. From the old skill's `references/`, copy
   each file that the new skill's `references/` lacks, such as each `feature-*.md` file. Keep the
   template's copy of each file that both folders hold. When the old file is the repo's own, not a
   copy of an older template's file, give it a new name, copy it, and fix each link to it.
5. In the new `SKILL.md`, replace the feature table between the `wringer:features` markers with the
   output of `bun verify features --markdown`.
6. Copy the frontmatter's `name`, `description` and `metadata.wringer-command` from the old
   `SKILL.md` into the new one. Copy the `#` title and each `<!-- repo -->` block too. When the new
   template renames or adds a block, fill it from the old skill's matching content.
7. In the lockfile's git history, find the `@wringer/gunshi` version from before the bump. Read the
   release notes of each later version on <https://github.com/zgeoff/wringer/releases>. Apply what
   they ask of the `<!-- repo -->` blocks, `verify.ts` and the registry.
8. Run `bun verify lint`. Expect: `ok: true`. Then delete the old skill and its line in
   `.git/info/exclude`.
