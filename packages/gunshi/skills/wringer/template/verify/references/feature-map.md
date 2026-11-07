# Feature map

## add-item

- **What:** a user adds an item to the pantry.
- **How a user reaches it:** open `/pantry`, type a name, and press Add.
- **Drive:**

  ```bash
  bun verify use --feature add-item
  bun verify items count
  bun verify action add-item --name Oats
  bun verify items count
  ```

- **End state:** the second `items count` returns one more item than the first. Run
  `bun verify http request --path /api/items` too: its `data.json` lists `Oats`.
