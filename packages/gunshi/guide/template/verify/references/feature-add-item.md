# add-item

A user adds an item to the pantry on the `/pantry` page, by typing a name and pressing Add. The
journey skips the page, and calls the API that the form calls.

## Journey

```bash
bun verify use --feature add-item
bun verify items count
bun verify action add-item --name Oats
bun verify items count
bun verify http request --path /api/items
```

## End state

- The second `items count` prints a `data.count` one more than the first.
- The `http request`, a GET of `/api/items`, prints every item as JSON in `data.json`. The list
  holds an item named `Oats`. An `Oats` item from an earlier journey can show there too, so only the
  count proves that this journey added one.
