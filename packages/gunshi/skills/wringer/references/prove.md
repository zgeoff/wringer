# Prove

Prove that the verify CLI, its registry and the repo's `verify` skill work before you open the PR
that adds them. A run is the app that `bun verify up` starts, and a verdict is what
`bun verify done` records for a feature.

- Make every change to the code, the registry and the `verify` skill before step 2. An edit after a
  `done` makes its verdict stale, and `report` then shows the feature as `stale`.
- When a step fails because the `verify` skill or the registry is wrong, fix it, and start again at
  step 1.
- Keep each step's command and the output lines its "Expect" names. Put them in the PR description
  under `## Verification`.

## Steps

1. Run `bun verify up`, then `bun verify doctor`. Expect: the doctor's last JSON line has `ok: true`
   and `data.passed: true`. Then run `bun verify down`.
2. Send the [fresh subagent brief](./fresh-subagent-brief.md) to a new subagent, and follow that
   reference until one subagent reaches `done` on every feature and names no gap. Expect: its reply,
   with exit code 0 from each `done`.
3. Check that the CLI refuses to drive a changed tree:
   1. Run `bun verify up`, then `bun verify doctor`.
   2. Add a blank line to a file that a feature's `paths` globs match.
   3. Run one line of that feature's journey that drives the app, such as an `action` or a `browser`
      command. Expect: exit code 3 and `error.code` `doctor-required`.
   4. Undo the edit, and run `bun verify down`.
4. When the Targets section of the `verify` skill lists a read-only target, check that it refuses a
   write. Skip this step when it lists none.
   1. Start the instance the target attaches to, as the skill says.
   2. Run `bun verify use --target <target>`, then `bun verify attach`, then `bun verify doctor`.
   3. Run one command that `--help` marks `[write]`, such as a write action. Expect: exit code 3 and
      `error.code` `read-only`.
   4. Run `bun verify detach`, then `bun verify use --target local`.
5. Run `bun verify report --human`. Expect: each feature that the branch changes shows `verified`.
   Paste the whole output in the PR description, under `## Verification`. Keep the HTML comment at
   its end: the gate reads the report from it.
