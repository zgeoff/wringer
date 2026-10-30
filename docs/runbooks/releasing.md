# Releasing

release-please and the `main` workflow release each `@wringer/*` package to npm on its own version.
The workflow's release job calls the shared release-please workflow of `zgeoff/tools` at the repo's
sync tag, with its merge input off. release-please opens one release pull request after a releasable
commit lands on `main`, with a version bump and a changelog for each package the commit changed. The
run of that pull request's merge tags each release, then dispatches a run of `main` at the tag,
which publishes each released package with npm provenance once its checks pass. This runbook holds
only the steps the tooling does not do: the one-time setup, the first publish of each new package,
merging each release pull request, and the recoveries a failed release needs.

## One-time setup

The release and publish jobs in `.github/workflows/main.yml` run only once the `RELEASE_ENABLED`
repo variable is `true`. Before that, publish each package once by hand, as
[Publish a new package](#publish-a-new-package) describes, because npm sets up trusted publishing
only for a package that exists on the registry.

1. Set the release App's client ID as the `RELEASE_APP_ID` repo variable and its private key as the
   `RELEASE_APP_PRIVATE_KEY` secret, so the release pull request runs its checks.
2. In the repo's Settings, under Actions and then General, check "Allow GitHub Actions to create and
   approve pull requests". release-please needs it to open the release pull request.
3. Turn the release job on:

   ```bash
   gh variable set RELEASE_ENABLED --repo zgeoff/wringer --body true
   ```

   Expect `gh variable list --repo zgeoff/wringer` to show `RELEASE_ENABLED` with the value `true`.

4. Push or merge the next commit to `main`. Expect the `main` workflow's release job to run.

## Publish a new package

A package's first version goes out from a maintainer's machine, and CI publishes every later one.

1. Sign in to npm as an account that can publish under the `@wringer` scope:

   ```bash
   npm login
   npm whoami
   ```

   Expect `npm whoami` to print your npm username.

2. From the repo root, on an up-to-date `main`, run the first publish with the package's folder name
   under `packages/`:

   ```bash
   bash scripts/first-publish.sh <folder>
   ```

   Expect `published @wringer/<folder>@<version>`, followed by the trusted publisher settings. The
   script stops with `already exists on npm` when the package is on npm.

3. Open `https://www.npmjs.com/package/@wringer/<folder>/access` and add a trusted publisher for
   GitHub Actions with the settings the script printed. Expect the publisher listed on the access
   page.
4. Turn on "Allow npm publish" for the publisher. A publisher created after 3 September 2026 allows
   only `npm stage publish` without it, and the `main` workflow runs `npm publish`, so its publish
   fails with `ENEEDAUTH`. Expect the access page to show the publisher with npm publish allowed.

## Merge a release pull request

Nothing merges a release pull request on its own, so each release waits for a maintainer.

1. Find the open pull request from the `release-please--branches--main` branch. Its changes bump
   each released package's version and update its changelog. The release job adds a commit that
   syncs the lockfile and the formatting when the bump needs one.
2. Check that the pull request passes its checks, then merge it.
3. Expect a new `main` workflow run. Its release job tags `@wringer/<folder>@<version>` for each
   released package, and its `Dispatch the release publish` job starts a run of `main` at the tag.
   The log of that run's publish step ends with each package's `npm publish`.
4. Check the registry:

   ```bash
   npm view @wringer/<folder> version
   ```

   Expect the version you released.

## Recover a release blocked by a workflow change

The release App's token has no Workflows permission, so GitHub refuses it a tag on a merge commit
that a change to `.github/workflows/` has left behind the head of `main`. The shared job then fails
before release-please runs, and its error names the release pull request and its merge commit. It
fails on every later run until you tag each release with your own token, which holds the workflow
scope:

1. Read the merge commit of the release pull request:

   ```bash
   gh pr view <pr number> --repo zgeoff/wringer --json mergeCommit --jq .mergeCommit.oid
   ```

2. For each package the pull request released, create its release at that commit, with the version's
   section of the package's `CHANGELOG.md` as its notes:

   ```bash
   gh release create '@wringer/<folder>@<version>' --repo zgeoff/wringer --target <merge commit> --title '@wringer/<folder>@<version>' --notes-file <notes file>
   ```

3. Mark the pull request tagged, so release-please stops retrying it:

   ```bash
   gh pr edit <pr number> --repo zgeoff/wringer --remove-label 'autorelease: pending' --add-label 'autorelease: tagged'
   ```

4. Publish from one of the tags with the steps in
   [Republish a release that failed to publish](#republish-a-release-that-failed-to-publish). Expect
   the next run of the release job to pass.

## Republish a release that failed to publish

A release can tag and then fail in its publish step, such as on an npm outage. Dispatch the `main`
workflow at the tag, with the folder of each package to publish:

1. Dispatch the run:

   ```bash
   gh workflow run main.yml --repo zgeoff/wringer --ref '@wringer/<folder>@<version>' -f republish_paths='["packages/<folder>"]'
   ```

   The dispatched run skips the release job, and once its checks pass, it publishes each listed
   package from the tag.

2. Watch the run:

   ```bash
   gh run watch --repo zgeoff/wringer
   ```

   Expect the publish step to publish each package, or to print
   `skipping @wringer/<folder>@<version>: already published` when npm holds that version.
