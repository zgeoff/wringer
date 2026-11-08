# Prove

Prove that the verify CLI, its registry and the repo's `verify` skill work before you open the PR
that adds them.

- Make every change to the code, the registry and the `verify` skill before step 2. A verdict holds
  for the code as it was at `done`: an edit makes it stale, and undoing the edit makes it hold
  again.
- When a fresh subagent names a gap, follow the brief. When another step fails because the `verify`
  skill, the registry or the CLI code is wrong, fix it, and start again at step 1.
- For each step, put its command and the output lines its "Expect" lists in the PR description,
  under `## Verification`. Add the heading when the PR template lacks it.

## Steps

1. Run `bun verify up`, then `bun verify doctor`. Expect: the doctor's last JSON line has `ok: true`
   and `data.passed: true`. Then run `bun verify down`.
2. Send the [fresh subagent brief](./fresh-subagent-brief.md) to a new subagent, and follow that
   reference until one subagent reaches `done` on every feature and names no gap. Expect: its reply,
   with exit code 0 from each `done`. Put each feature's `done` line from it in the PR.
3. Check that the CLI refuses to run against a changed tree:
   1. Run `bun verify up`, then `bun verify doctor`. Expect: `data.passed: true`.
   2. Add a blank line to a file that a feature's `paths` globs match.
   3. Run one line of that feature's journey that touches the app, such as an `action` or a
      `browser` command. Expect: exit code 3 and `error.code` `doctor-required`.
   4. Undo the edit, and run `bun verify down`.
4. When the Targets section of the `verify` skill lists a read-only target, check that it refuses a
   write. Skip this step when it lists none.
   1. Start the instance the target attaches to, as the skill says. Use an instance you may lose
      data on, in case the refusal is broken.
   2. Run `bun verify use --target <target>`, then `bun verify attach`, then `bun verify doctor`.
   3. Run one command that `--help` marks `[write]`, such as a write action. Expect: exit code 3 and
      `error.code` `read-only`.
   4. Run `bun verify detach`, then `bun verify use --target local`.
5. Run `bun verify report --human`. Expect: each feature whose `paths` match a file the branch
   changes shows `verified`, and every other feature shows `unchanged`. Paste the whole output into
   the PR description as it is, outside a code block. The gate reads the report from the HTML
   comment at its end.
