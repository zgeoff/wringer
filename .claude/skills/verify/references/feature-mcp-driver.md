# mcp-driver

The mcp driver, `@wringer/mcp`, calls the tools of the shop's MCP server. `bun verify up` starts the
shop app and the MCP server, so you start nothing yourself. The server has two tools, and neither
takes arguments:

- `list_orders` lists the shop's orders.
- `place_order` places one order for a `mug`.

Before each pass of the journey, run `bun verify up --restart` and `bun verify doctor`. Expect:
`doctor` returns `data.passed: true`. The restart empties the orders table, so the first
`list_orders` returns no orders and the next order gets the `id` 1.

## Journey

```bash
bun verify use --feature mcp-driver
bun verify mcp tools
bun verify mcp call list_orders
bun verify mcp call place_order
bun verify mcp call list_orders
```

Each command names no server. On a target with more than one server, add `--server <name>`.

## End state

Read each result in the command's JSON envelope, as
[Read the envelope](../SKILL.md#read-the-envelope) says. Each field below sits under `data`, except
`evidence`, which sits at the top level. A tool that fails still returns `ok: true`, so check
`isError` on each call.

- `mcp tools` returns `server: "shop"` and exactly two entries in `tools`. `list_orders` has
  `inReadTools: true` and `place_order` has `inReadTools: false`. `inReadTools` is true when the
  target's config lists the tool in `readTools`, the tools a read-only target allows.
- The first `mcp call list_orders` returns `isError: false` and `structuredContent.orders` as an
  empty list. Its `evidence` holds one file, `call-list_orders.json`.
- `mcp call place_order` returns `isError: false` and `structuredContent.id` 1.
- The second `mcp call list_orders` returns `isError: false` and one order in
  `structuredContent.orders`, with `id` 1 and `item` `mug`.
