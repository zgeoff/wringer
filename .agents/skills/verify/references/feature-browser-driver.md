# browser-driver

The browser driver opens the shop page in a real browser and reads it as an accessibility tree.

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

Each command exits 0. A non-zero exit fails the journey.

- The first snapshot holds a button named `Place order`.
- The `hover` output holds the page's title, `Shop`, in `data.title`. The page shows `Place order`
  once, so `--text` finds one element.
- The last snapshot holds a heading `Order <id> placed`, with any order ID in place of `<id>`. The
  command waits until the snapshot text holds `placed`, with case counted.
