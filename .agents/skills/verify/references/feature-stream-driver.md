# stream-driver

The stream driver reads the lines that the shop writes to its log.

## Journey

```bash
bun verify use --feature stream-driver
bun verify action place-order
bun verify stream read app
```

## End state

- The log holds the line `order <id> placed` exactly once, where `<id>` is the `data.id` of
  `action place-order`.

The journey's `stream read app` returns the lines logged since `use` ran. The line can reach the log
after that read returns. When the line is missing:

1. Wait one second.
2. Run `bun verify stream read app --from 0`, which reads the whole log.
3. Repeat steps 1 and 2 until the line shows, for at most four rereads. When the fourth reread still
   lacks the line, report the feature as not verified.
