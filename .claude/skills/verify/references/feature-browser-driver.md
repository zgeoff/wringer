# browser-driver

The browser driver opens the shop page in a real browser, reads it as an accessibility tree, and
clicks and types by role and name.

## Journey

```bash
bun verify use --feature browser-driver
bun verify browser goto /
bun verify browser snapshot
bun verify browser click --role button --name 'Place order'
bun verify browser snapshot
```

## End state

- The first snapshot holds a button named `Place order`.
- The second snapshot holds a heading that reads `Order <id> placed`, with any order ID in place of
  `<id>`.
