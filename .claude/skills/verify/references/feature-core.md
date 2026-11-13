# core

The core runs the app, keeps each run and the evidence of each command, and reports each verdict.

## Journey

```bash
bun verify use --feature core
bun verify status
bun verify action place-order
bun verify orders count
```

## End state

- `status` shows a run on `local` with the doctor passed and the feature set to `core`.
- `action place-order` lists an evidence file in `evidence`, and the file exists under `.wringer/`.
- `orders count` returns `data.orders` of at least 1.
