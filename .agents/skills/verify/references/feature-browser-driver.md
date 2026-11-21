# browser-driver

The browser driver opens the shop page in a real browser, reads it as an accessibility tree, finds
elements by role and name or by the text they show, and waits for the page to show an order's
confirmation.

## Journey

```bash
bun verify use --feature browser-driver
bun verify browser goto /
bun verify browser snapshot
bun verify browser hover --text 'Place order'
bun verify browser click --role button --name 'Place order'
bun verify browser snapshot --until-text placed
```

## End state

- The first snapshot holds a button named `Place order`.
- The `hover` exits 0 and returns the page's URL and its title, `Shop`.
- The second snapshot holds a heading that reads `Order <id> placed`, with any order ID in place of
  `<id>`, and the command exits 0 with no timeout.
