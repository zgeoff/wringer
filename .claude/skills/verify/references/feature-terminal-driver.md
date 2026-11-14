# terminal-driver

The terminal driver runs the shop's terminal screen, which lists the orders, and reads what it
shows. Pressing `r` redraws the list and counts the refresh.

Before each pass of the journey, run `bun verify up --restart` and `bun verify doctor`. The driver
numbers the sessions of a run, stopped ones included, so without a restart a second pass starts
`tui-2` and fails the end state.

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

- `tui` names a program in the `local` target of the shop's wringer registry.
- The shop's screen puts two spaces between the order ID and `mug`, so write two in the regex.

## End state

Rows count from 0. Each field below sits under the envelope's `data`, except `evidence`, which sits
at the top of the envelope.

- `terminal start tui` returns `session` `tui-1`.
- The first `terminal wait` returns `match.row` 1, and its `screen.text` starts with the line
  `Shop orders`.
- The second `terminal wait` exits 0.
- `terminal screen` returns a `text` with a line that contains `<id>  mug`, where `<id>` is the `id`
  that `action place-order` returned, and a line that contains `Refreshes: 1`. Its `evidence` lists
  one `screen.txt` file.
- `terminal stop` returns `exitCode` 143, the code of a program that the driver ended.
