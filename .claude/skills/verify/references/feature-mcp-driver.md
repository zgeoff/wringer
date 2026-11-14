# mcp-driver

The mcp driver calls the tools of the shop's MCP server, which runs as a child process of the run's
supervisor. `list_orders` reads the orders through the shop's API, and `place_order` places one.

Before each pass of the journey, run `bun verify up --restart` and `bun verify doctor`. A restart
gives the shop an empty orders table, so the first `list_orders` returns no orders.

## Journey

```bash
bun verify use --feature mcp-driver
bun verify mcp tools
bun verify mcp call list_orders
bun verify mcp call place_order
bun verify mcp call list_orders
```

- `shop` is the only server the `local` target names, so no command passes `--server`.
- Pass `--args '<json>'` to a tool that takes arguments. The shop's two tools take none.

## End state

Each field below sits under the envelope's `data`, except `evidence`, which sits at the top of the
envelope.

- `mcp tools` returns `server` `shop` and two tools. `list_orders` has `inReadTools` true, and
  `place_order` has `inReadTools` false.
- The first `mcp call list_orders` returns `isError` false and `structuredContent.orders` as an
  empty list. Its `evidence` lists one `call-list_orders.json` file.
- `mcp call place_order` returns `isError` false and `structuredContent.id` 1.
- The second `mcp call list_orders` returns `structuredContent.orders` with one order, whose `id` is
  1 and whose `item` is `mug`.
