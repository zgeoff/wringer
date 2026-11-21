# Browser locators

The `click`, `type`, `check`, `uncheck`, `press` and `hover` commands of `@wringer/browser` name
their element with flags. Each command takes one of four forms: a ref, a role and a name, a label,
or a shown text. A `press` with no form presses the key on the focused element. A flag mix that fits
no form fails with a usage error, and the exit code is 2.

| Form       | Flags                 | Finds                                                              |
| ---------- | --------------------- | ------------------------------------------------------------------ |
| Ref        | `--ref`               | the element of that ref in the last `browser snapshot`             |
| Role       | `--role` and `--name` | the element of that role whose accessible name is exactly the name |
| Label      | `--label`, `--role`   | the control that has the label, narrowed by the role when given    |
| Shown text | `--text`, `--role`    | the visible element that shows the text, as the sections below say |

`--ref` takes no other flag. `--name` takes `--role` and nothing else. `--role` alone is a usage
error. `--label` and `--text` each take `--role` at most, and never go with each other or with
`--name`.

## Ref

A ref acts on the element of the last snapshot, so take a new snapshot after the page changes. A tab
switch forgets the refs.

## Role and name

The match is Playwright's `getByRole` with an exact name. Two matching elements fail with a usage
error that points at refs.

## Label

The match is Playwright's `getByLabel` with an exact label. No control with the label waits out the
action timeout, then fails with `check-failed`. Several matches fail at once with a usage error: add
`--role` or use `--ref`.

## Shown text

`--text` finds an element by the text a person sees. It helps for a menu item, a card or any control
that has no useful role or name.

- With `--text` alone, the element is the innermost visible element whose whole shown text equals
  the text.
- With `--role`, the element is any visible element of that role whose shown text contains the text.
- The comparison is case-sensitive. Runs of whitespace, line breaks and the gap between two blocks
  each read as one space.
- Hidden elements add no text, and hidden elements never match. The match reaches into open shadow
  roots.
- CSS `text-transform` has no effect, so the match reads the text as written in the page.
- An `aria-label` is never shown text.

No match waits out the action timeout, then fails with `check-failed`. More than one match fails at
once with `check-failed` and the number of matches: add `--role`, make the text longer, or use
`--ref`.

## Read-only targets

A write on a read-only target needs a grant in `readOnly.allow` that lists the element's role and
exact name. The command cannot see a ref's role, so name a granted element by `--role` and `--name`,
by `--label` with `--role`, or by `--text` with `--role`. A `--text` with no `--role` is always a
write.

A granted `--text` also requires the element's accessible name to equal the text, so a button named
`Search all orders` is never clicked under the grant for `Search`.

A granted write runs every wait first, checks that the active tab is on the origin of the default
endpoint or a listed one, and then acts at once.
