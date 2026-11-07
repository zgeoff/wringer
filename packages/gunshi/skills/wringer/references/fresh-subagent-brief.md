# Fresh subagent brief

Send the brief below to a new general-purpose subagent. Never use a fork: a fork carries your
context, and the subagent must know only what the repo's `verify` skill tells it. Fill in the three
placeholders, and add nothing else. A fact you add about the app or the CLI hides a gap in the
skill.

- `<repo root>`: the absolute path of the repo.
- `<skill path>`: the path of the repo's `verify` skill.
- `<features>`: every feature name that `bun verify features` lists.

```text
Load the skill at <skill path> and read it whole. It tells you how to drive this repo's app with
its verify CLI.

Your task: for each of these features, run the CLI's `done` command and get exit code 0:
<features>.

- Use only what the skill says and what the CLI prints, `--help` included. Read no source code.
- Run every command from the repo root, <repo root>.
- Leave the app's code and the skill unchanged.
- When you finish, stop the app with the command the skill gives.

Reply with:
1. For each feature: each command you ran, its exit code, and the `ok`, `feature` and
   `data.fingerprint` fields of the JSON that `done` printed.
2. Each place where the skill left you to guess, was wrong, or sent you to the source: the line of
   the skill, what you needed, and what you did instead. Write "none" when there was none.
```

When the subagent names a gap, fix the skill, and send the same brief to a new subagent. When a
`done` fails and the subagent names no gap, find the cause before you change the skill: the app or
the registry may be wrong. Stop when one subagent gets exit code 0 from `done` on every feature and
names no gap. Its reply is the proof for the PR.
