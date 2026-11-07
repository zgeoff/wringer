# Fresh subagent brief

Fill in `<skill path>` and `<features>`, and send the brief as the subagent's whole prompt. Add
nothing about the app, the registry or how you built them: the run shows whether the `verify` skill
alone is enough.

```text
Load the skill at <skill path> and read it whole. It tells you how to drive this repo's app with
its verify CLI.

Your task: reach a passing `done` on each of these features, in this worktree: <features>.

- Use only what the skill says and what the CLI prints, `--help` included. Read no source code.
- Run every command from the repo root.
- Leave the app's code and the skill unchanged.
- Stop the run when you finish.

Reply with:
1. For each feature: each command you ran, its exit code, and the `done` envelope's `ok`, `feature`
   and `data.fingerprint`.
2. Each place where the skill left you to guess, was wrong, or sent you to the source: the line of
   the skill, what you needed, and what you did instead. Write "none" when there was none.
```

The fingerprint of a `done` is the hash of the change against its base, and `report` compares it
with the current tree. When the subagent names a gap, fix the skill, and start a new subagent with
the same brief.
