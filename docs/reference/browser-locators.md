# Browser locators

The `click`, `type`, `check`, `uncheck`, `press` and `hover` commands of `@wringer/browser` take
flags that name one element on the page. Pass the flags of one row:

| Way to name it | Flags                           | The command acts on                                         |
| -------------- | ------------------------------- | ----------------------------------------------------------- |
| Ref            | `--ref`                         | the element with that ref in the last `browser snapshot`    |
| Role and name  | `--role` with `--name`          | the element of that role whose accessible name is the name  |
| Label          | `--label`, with `--role` or not | the control with that label, of that role when you give one |
| Shown text     | `--text`, with `--role` or not  | the visible element that shows the text                     |

When you pass any other mix of these flags, the command fails with `usage`. When you pass none,
`press` presses its key on the element that has focus. The
[error codes](../../packages/core/README.md#error-codes) table in the core README lists the exit
code of each error.

## When the command fails

For each way but a ref, the command waits for a match up to `actionTimeoutMs`, which you set in
`browser()` as the [browser README](../../packages/browser/README.md) shows. When the time runs out
with no match, the command fails with `check-failed`.

When two or more elements match, the command fails at once, with no wait:

- with `usage` for a role and name, or a label;
- with `check-failed` and the count for a shown text.

To pick one element, add `--role`, give a longer text, or pass `--ref`.

## Ref

`browser snapshot` prints a ref on each element, such as `[ref=e5]`, which you pass as `--ref e5`.
After the page changes or you switch tabs, take a new snapshot before you pass a ref. When the last
snapshot has no element with the ref, the command fails with `usage`.

## Role and name, and label

The command uses Playwright's `getByRole` or `getByLabel`, and matches the name or the label
exactly.

## Shown text

Use `--text` for an element that a person finds by its text, such as a menu item or a card with no
useful role or name.

- With `--text` alone, the command finds the innermost visible element whose whole text is exactly
  the text. A click on a `<span>` inside a button reaches the button.
- With `--role` too, the command finds the visible element of that role whose text contains the
  text.

The command reads an element's text as a person sees it:

- Case counts.
- Each run of spaces, each line break, and the break between two block elements read as one space.
- The command skips hidden elements and hidden text.
- The command reads into open shadow roots.
- The command reads the text as the page's HTML writes it, before CSS `text-transform`.
- The command never reads an `aria-label` as text.

## Read-only targets

The [browser README](../../packages/browser/README.md#read-only-targets) says which commands a
read-only target refuses, with exit code 3, and how a role and an exact name in `readOnly.allow`
grant one. Two rules apply to `--text`:

- A read-only target always refuses `--text` without `--role`.
- For `--text` with `--role`, the grant covers the element only when its accessible name is exactly
  the text. A grant for the button `Search` never covers a button named `Search all orders`.
