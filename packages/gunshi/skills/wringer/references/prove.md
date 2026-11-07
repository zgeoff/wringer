# Prove

- Run each step on a branch whose code is committed. A verdict holds for the tree's fingerprint, and
  a later commit with the same changes keeps it, but an edit after `done` makes it stale.
- Keep the output lines each step names. They go in the PR description under `## Verification`, with
  the command that gives them.
- When a step fails because the skill or the registry is wrong, fix it and run the step again. When
  the fresh subagent got stuck, start a new one after the fix: the first one now knows the answer.

## Steps

1. Start the app and run the doctor:

   ```bash
   bun verify up
   bun verify doctor
   ```

   Expect: the doctor's envelope has `ok: true`, and every check in `data` passed.

2. Give a fresh subagent the [fresh subagent brief](./fresh-subagent-brief.md), with the path of the
   `verify` skill and the feature names from `bun verify features`. Give it nothing else. Expect:
   its reply lists a `done` envelope with `ok: true` for every feature, and no gap in the skill. For
   each gap it names, fix the skill and run this step again.
3. With the run still up and the doctor passed, change one file under a feature's `paths`, and run
   one drive command of that feature. Expect: exit code 3, `error.code` `doctor-required`, and the
   hint `Run \`up --restart\`, then \`doctor\`.`. Undo the change.
4. When the repo has a read-only target, attach to it, run the doctor, and run one write, such as a
   write action. Expect: exit code 3 and `error.code` `read-only`. Then detach.
5. After the subagent's run, from the same worktree:

   ```bash
   bun verify report --human
   ```

   Expect: every feature `verified`. Paste the whole output in the PR description, the hidden report
   block at its end included.

6. Stop the app with `bun verify down`.
