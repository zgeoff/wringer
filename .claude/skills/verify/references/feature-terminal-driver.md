# terminal-driver

The terminal driver runs the shop's terminal screen, which lists the orders, and reads what it
shows. Pressing `r` redraws the list and counts the refresh.

## Journey

```bash
bun verify use --feature terminal-driver
bun verify action place-order
bun verify terminal start tui
bun verify terminal wait --regex '\d+  mug'
bun verify terminal press r
bun verify terminal wait --text 'Refreshes: 1'
bun verify terminal screen
bun verify terminal stop
```

## End state

- `terminal start tui` returns the session `tui-1`.
- The first `terminal wait` returns a `match` on row 1, and its `screen.text` starts with the line
  `Shop orders`.
- `terminal screen` returns a `text` that holds the line `<id>  mug`, where `<id>` is the `data.id`
  of `action place-order`, and the line `Refreshes: 1`. Its evidence is a `screen.txt` file with the
  same text.
- `terminal stop` returns `exitCode` 143, the exit code of a program that the driver ended.
