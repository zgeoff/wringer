# place-order

A shopper places an order from the shop page at `/`, by pressing Place order.

## Journey

```bash
bun verify use --feature place-order
bun verify orders count
bun verify browser goto /
bun verify browser click --role button --name 'Place order'
bun verify browser snapshot
bun verify orders count
```

## End state

- The page's heading in the snapshot reads `Order <id> placed`, with any order ID in place of
  `<id>`.
- The second `orders count` returns one more order than the first.
