# order-failure

When an order fails, the shop page at `/` shows the shopper an error. To make every order fail, the
journey drops the `orders` table from the database of the app that `up` started. It then presses
Place order.

Run this journey after every other one: the table stays dropped until `bun verify up --restart`
starts the app on a new, empty database.

## Journey

```bash
bun verify use --feature order-failure
bun verify db query 'drop table orders' --write
bun verify browser goto /
bun verify browser click --role button --name 'Place order'
bun verify browser snapshot
```

## End state

- The page's heading in the snapshot starts with `The order failed`.
