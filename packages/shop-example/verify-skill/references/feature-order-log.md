# order-log

The app writes one line to its log for each order placed.

## Journey

```bash
bun verify use --feature order-log
bun verify action place-order
bun verify stream read app
```

## End state

- The log holds the line `order <id> placed` once, where `<id>` is the `data.id` of
  `action place-order`.

The line can reach the log after `stream read` returns. When it is missing, wait one second, and
read the whole log with `bun verify stream read app --from 0`. After five reads without it, counting
the journey's read, report the feature as not verified.
