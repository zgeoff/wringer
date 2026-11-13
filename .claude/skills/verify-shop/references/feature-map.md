# Feature map

Run every journey here on the `local` target, which `bun verify use --target local` selects. Each
journey places an order or drops a table, and the read-only `demo` target refuses both writes.

Run the `order-failure` journey last. It drops the `orders` table, so every later order fails until
`bun verify up --restart` starts the app on a new, empty database. To run another feature's journey
after it, run `bun verify up --restart`, then `bun verify doctor`. Expect: `data.passed: true`.

## place-order

- **What:** a shopper places an order from the shop page.
- **How a user reaches it:** open `/`, and press Place order.
- **Journey:**

  ```bash
  bun verify use --feature place-order
  bun verify orders count
  bun verify browser goto /
  bun verify browser click --role button --name 'Place order'
  bun verify browser snapshot
  bun verify orders count
  ```

- **End state:** the snapshot's heading reads `Order <id> placed`, and the second `orders count`
  returns one more order than the first.

## list-orders

- **What:** the orders API lists every placed order.
- **How a user reaches it:** a client calls `GET /api/orders`.
- **Journey:**

  ```bash
  bun verify use --feature list-orders
  bun verify action place-order
  bun verify http request --path /api/orders
  ```

- **End state:** `data.status` is 200, and `data.json` lists the order with the `id` that the action
  returned, with the item `mug`.

## order-log

- **What:** the app logs one line for each order placed.
- **How a user reaches it:** an operator reads the app's output.
- **Journey:**

  ```bash
  bun verify use --feature order-log
  bun verify action place-order
  bun verify stream read app
  ```

- **End state:** the stream holds the line `order <id> placed`, with the `id` that the action
  returned. When the line is missing, wait a second and read the stream again. After 5 misses,
  report the feature as not verified.

## order-failure

- **What:** the page tells the shopper when an order fails.
- **How a user reaches it:** press Place order while the orders API fails.
- **Journey:**

  ```bash
  bun verify use --feature order-failure
  bun verify db query 'drop table orders' --write
  bun verify browser goto /
  bun verify browser click --role button --name 'Place order'
  bun verify browser snapshot
  ```

- **End state:** the snapshot's heading starts with `The order failed`.

## guide

- **What:** the CLI prints the guide for adding a verify CLI to a repo, from the installed package.
- **How a user reaches it:** run `bun verify guide`, or `bun verify guide <topic>`.
- **Journey:**

  ```bash
  bun verify use --feature guide
  bun verify guide
  bun verify guide create
  bun verify http request --path /api/orders
  ```

- **End state:** the first `guide` lists `create` in `data.topics`, and the second has `data.text`
  starting with `# Create`. The `http request` only lets `done` record the verdict: `done` needs one
  command that touches the app, and `guide` does not.
