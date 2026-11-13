# cli

The CLI parses the command line and prints each command's result: a JSON envelope, or text with
`--human`.

## Journey

```bash
bun verify use --feature cli
bun verify features --markdown
bun verify orders count --help
bun verify orders count --human
```

## End state

- `features --markdown` returns `ok: true` and a `data.markdown` table with one row for each feature
  in the feature table of [SKILL.md](../SKILL.md).
- `orders count --help` prints the command's flags and exits 0.
- `orders count --human` prints text, not JSON.
