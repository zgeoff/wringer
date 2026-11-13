# db-driver

The db driver runs SQL on the shop's database and returns the rows.

## Journey

```bash
bun verify use --feature db-driver
bun verify db query 'select count(*) as orders from orders'
bun verify action place-order
bun verify db query 'select count(*) as orders from orders'
```

## End state

- The `orders` value in the first row of the second query is one more than in the first query.
