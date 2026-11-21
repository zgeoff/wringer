# 0001: Fingerprint each feature separately

- Date: 2026-11-21
- Status: decided

This record uses the words the [terms](../reference/terms.md) page defines: registry, feature,
journey, verdict, fingerprint, report, gate, shared glob and ignore list.

## Decision

When `bun verify done` records a verdict, it stores a fingerprint of that feature alone: a hash of
the part of the diff against the PR's base branch whose paths match the feature's `paths` or a
shared glob. The verdict goes stale only when that fingerprint changes.

The report that `bun verify publish` writes into the PR description ends with the data comment, an
HTML comment that holds one claim per feature. A claim is the verdict's data, its fingerprint
included. Version 2 of the comment's format holds these claims.

## Why

A fingerprint of the whole diff changes on any edit anywhere in the branch. Every verdict then goes
stale, and the agent has to run every feature's journey again after each edit. A fingerprint per
feature changes only when the feature's own files or a shared glob change, so an edit to one feature
leaves every other verdict standing. A registry lists as shared globs only the few files whose
change affects every feature, such as the lock file.

## Rejected alternatives

- **One fingerprint of the whole diff.** Any edit makes every verdict stale, as Why describes.
- **A verdict tied to a commit.** A rebase, or a commit that touches only another feature, makes
  every verdict stale.

## Consequences

- `bun verify gate` fails a version 1 data comment, because it holds no fingerprint per feature.
  Running `publish` again writes a version 2 comment.
- `bun verify gate` fails each changed path that matches no feature's `paths`, no shared glob and
  nothing in the ignore list, so each changed path belongs to a feature, is shared, or is ignored.
