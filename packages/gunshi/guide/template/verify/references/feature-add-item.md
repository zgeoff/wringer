# add-item

Check that an item added to the pantry reaches the item list. On the `/pantry` page, a user types a
name and presses Add, and the form sends it to the items API. The journey calls that API, as the
form does, so it checks a change to the API. It never loads the page.

## Journey

```bash
bun verify use --feature add-item
bun verify items count
bun verify action add-item --name Oats
bun verify items count
bun verify http request --method GET --path /api/items
```

## End state

Both must hold:

- The second `items count` prints a `data.count` one more than the first `items count`.
- The `data.json` of `http request` lists an item named `Oats`. An earlier journey may have left an
  `Oats` item, so this check alone proves nothing.
