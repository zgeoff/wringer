# guide

`bun verify guide` lists the topics of the guide for adding a verify CLI to a repo, and
`bun verify guide <topic>` prints one topic.

- Run `bun verify up` and `bun verify doctor` before the journey, as for every feature. `done`
  refuses a run whose doctor has not passed, even though the `guide` command never touches the app.
- Expect `guide nope` to fail. `done` counts only the `guide` commands that passed.

## Journey

```bash
bun verify use --feature guide
bun verify guide nope
bun verify guide
bun verify guide create
```

## End state

- `guide nope` exits 2 with `error.code` `usage`, and its `error.hint` lists the topics.
- `guide` returns `data.topics`, a list that holds `create`.
- `guide create` returns `data.topic` `create`, the topic's `data.text`, and `data.version`, the
  version of the installed `@wringer/gunshi`.
