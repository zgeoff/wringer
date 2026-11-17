# http-driver

The http driver sends requests to the shop and keeps each response as evidence.

## Journey

```bash
bun verify use --feature http-driver
bun verify http request --path /api/orders
bun verify action place-order
bun verify http request --path /api/orders
```

## End state

- Each `http request` returns `data.status` 200 and a `data.json` list of orders.
- The second list is one entry longer than the first.
