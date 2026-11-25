# Documentation

## Architecture

- [How a change is verified](./architecture/how-a-change-is-verified.md): the path of a change, the
  processes, the state folder, and where each subsystem's doc is.
- [Verdicts and the gate](./architecture/verdicts.md): how a verdict is tied to its feature's code,
  how it goes stale, and how `gate` decides.
- [PR report](./architecture/pr-report.md): how `publish` writes the report into the PR description,
  fits it to GitHub's limit, and uploads its evidence.
- [Redaction](./architecture/redaction.md): how secrets stay out of everything a run publishes.
- [Self-verify](./architecture/self-verify.md): how wringer verifies its own changes.

## Decisions

- [0001: Fingerprint each feature separately](./decisions/0001-fingerprint-each-feature-separately.md):
  why a verdict goes stale only when its own feature's code changes.

## Runbooks and reference

- [Releasing](./runbooks/releasing.md): the one-time release setup, the first publish of a new
  package, merging a release pull request, and the recoveries a failed release needs.
- [Terms](./reference/terms.md): what registry, target, driver, action, command, feature, journey,
  run, doctor, verdict, fingerprint, evidence, report, gate, shared glob and ignore list mean.
