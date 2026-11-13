# add-item

A user adds an item to the pantry on the `/pantry` page, by typing a name and pressing Add. The
journey adds the item through the API that the form calls.

## Journey

```bash
bun verify use --feature add-item
bun verify items count
bun verify action add-item --name Oats
bun verify items count
bun verify http request --path /api/items
```

## End state

- The `data.count` of the second `items count` is one more than the first.
- The `data.json` of `http request` lists an item named `Oats`. An earlier run may have added one
  too. Only the count proves this run added it.
