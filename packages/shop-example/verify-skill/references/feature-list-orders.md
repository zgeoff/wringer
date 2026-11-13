# list-orders

A client lists every placed order with `GET /api/orders`.

## Journey

```bash
bun verify use --feature list-orders
bun verify action place-order
bun verify http request --path /api/orders
```

## End state

- The envelope of `http request` holds `data.status` 200.
- The `data.json` of `http request` lists an order whose `id` is the one in the `data.id` of
  `action place-order`, and whose item is `mug`. The action always orders a mug.
