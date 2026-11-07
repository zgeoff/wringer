---
name: verify-shop
description:
  'Drives the example shop app the way a user would with `bun verify`, and records the verdict that
  a feature works. Load it before you check a change to the shop example in the running app, drive a
  feature in its feature map, or put the verdicts in a PR.'
metadata:
  wringer-template: 1
  wringer-command: bun verify
---

# Verify the shop example

Use `bun verify` to start the app, drive a feature the way a user would, and record a verdict for
it. A drive is any command that acts on the running app, such as an action or `browser click`.
`bun verify done` records the verdict: the feature passed on this code. The CI gate fails a PR when
a feature it changes has no verdict for its current code, so hand back the output of
`bun verify report --human` for the PR body.

The mistakes that cost the most time:

- **Driving before `doctor` passes.** Every drive fails with exit code 3 until the doctor passes on
  the current run.
- **Editing the app's code during a run.** A verdict holds only for the code the run started on.
  After an edit, run `bun verify up --restart` and `bun verify doctor` again.
- **Branching on the error message.** Branch on the exit code and `error.code`. The message text can
  change in any release.

## Key rules

- [Run the loop](#run-the-loop): up, doctor, use, drive, done, report.
- [Read the envelope](#read-the-envelope): one JSON object per command, and an exit code to branch
  on.
- [Targets](#targets): the targets this repo declares, and what a read-only target refuses.
- [Commands](#commands): `bun verify --help` lists every command, each marked read or write.
- [Feature map](#feature-map): each feature's journey and the end state that proves it.
- [Keep the map true](#keep-the-map-true): fix a journey in the PR that breaks it, and run `lint`.

## Run the loop

1. Start a run with the command the [Targets](#targets) table gives. Expect: `ok: true`, and the
   app's endpoints in `data.endpoints`.
2. Run `bun verify doctor`. Expect: `data.passed: true`. When a check fails, fix its cause, and run
   `doctor` again.
3. Set the feature: `bun verify use --feature <feature>`. Each later drive records its evidence
   under that feature.
4. Run the feature's Drive block from the [feature map](#feature-map), and check its end state. When
   the end state is wrong, fix the app's code and start again at step 1, or report the failure.
5. Run `bun verify done`. Expect: `ok: true`. It fails unless a drive of the feature exited 0 after
   the doctor passed.
6. Repeat steps 3 to 5 for each feature the change touches. `bun verify report` marks each one with
   `changed: true`.
7. Run `bun verify report --human`, and put its output in the PR body in place of any older report.
   Keep the HTML comment at its end: the gate reads the report from it.
8. Stop the run: `bun verify down` on a launch target, or `bun verify detach` on an attach target.

## Read the envelope

Each command prints one JSON envelope as its last line. A streaming command, such as `doctor`,
prints its events as JSON lines before it. Read these fields:

- `ok`, then `data` on success, or `error.code`, `error.message` and `error.hint` on failure;
- `evidence`: the files the command kept, under `.wringer/`;
- `truncated` and `truncatedPath`: `data` was too large, and the file at `truncatedPath` holds it.

| Exit | `error.code`                                                        | Do                                                    |
| ---- | ------------------------------------------------------------------- | ----------------------------------------------------- |
| 0    | none                                                                | Go on.                                                |
| 1    | `check-failed`                                                      | The app failed a drive or a check. Read the evidence. |
| 2    | `usage`                                                             | Fix the command; `--help` shows its flags.            |
| 3    | `read-only`, `doctor-required`, `not-running`, `target-not-allowed` | Follow `error.hint`.                                  |
| 4    | `environment`, `internal`                                           | Fix the tool or the host, then retry.                 |
| 5    | `timeout`                                                           | Retry once with a larger `--timeout-ms`.              |

## Targets

`bun verify up` starts the app of a launch target, and `bun verify down` stops it. `attach` and
`detach` join an app that runs apart, and leave it running. Run `bun verify use --target <target>`
to point later commands at a target; `--target` on one command overrides it.

<!-- repo: targets -->

| Target  | Start with                                                              | Access     | Notes                                                       |
| ------- | ----------------------------------------------------------------------- | ---------- | ----------------------------------------------------------- |
| `local` | `bun verify up`                                                         | read-write | Starts the shop with an empty database in the run's folder. |
| `demo`  | `SHOP_DEMO_URL=http://127.0.0.1:<port> bun verify attach --target demo` | read-only  | A shop that runs apart from wringer. Never stop it.         |

Start a shop for `demo` with `bun packages/shop-example/src/shop-app.ts`. It prints its port in a
JSON line, such as `{"event":"listening","port":4310}`.

A read-only target refuses a write with exit code 3 and `read-only`. Stop, and report the write you
needed to whoever gave you the task.

<!-- /repo -->

## Commands

Run `bun verify --help` for the list, and `bun verify <command> --help` for a command's flags. The
help marks each command `[read]` or `[write]`.

- Run `bun verify <group> --help` to list the commands in a group, such as `action`. The top-level
  list shows the group alone.
- Each driver adds its own group, such as `http` or `browser`.
- Write a negative number with `=`, as in `--offset=-5`.
- Pass an object as JSON text, as in `--filter '{"shelf":"top"}'`.

<!-- repo: commands -->

- `bun verify action place-order` places one order through the API, as the page's button does.
- `bun verify orders count` counts the rows of the `orders` table.
- `bun verify browser snapshot` returns the page's accessibility tree, with a ref for each element
  that `browser click --ref` takes.
- `bun verify stream read app` returns the app's log lines since `use` last ran. Add `--from 0` to
  read from the start of the run.

<!-- /repo -->

## Feature map

Each entry says what the feature does, how a user reaches it in the app, the commands that drive it,
and the end state that shows it works. `bun verify features` lists each feature's `paths`: the files
whose change makes the gate ask for its verdict.

<!-- repo: features -->

Drive `order-failure` last: it drops the `orders` table, which breaks every later order on the run.

### place-order

- **What:** a shopper places an order from the shop page.
- **How a user reaches it:** open `/`, and press Place order.
- **Drive:**

  ```bash
  bun verify use --feature place-order
  bun verify orders count
  bun verify browser goto /
  bun verify browser click --role button --name 'Place order'
  bun verify browser snapshot
  bun verify orders count
  ```

- **End state:** the snapshot's heading reads `Order <id> placed`, and the second `orders count`
  returns one more order than the first.

### list-orders

- **What:** the orders API lists every placed order.
- **How a user reaches it:** a client calls `GET /api/orders`.
- **Drive:**

  ```bash
  bun verify use --feature list-orders
  bun verify action place-order
  bun verify http request --path /api/orders
  ```

- **End state:** `data.status` is 200, and `data.json` lists the order with the `id` that the action
  returned, with the item `mug`.

### order-log

- **What:** the app logs one line for each order placed.
- **How a user reaches it:** an operator reads the app's output.
- **Drive:**

  ```bash
  bun verify use --feature order-log
  bun verify action place-order
  bun verify stream read app
  ```

- **End state:** the stream holds the line `order <id> placed`, with the `id` that the action
  returned. When the line is missing, read the stream again, up to 5 times.

### order-failure

- **What:** the page tells the shopper when an order fails.
- **How a user reaches it:** press Place order while the orders API fails.
- **Drive:**

  ```bash
  bun verify use --feature order-failure
  bun verify db query 'drop table orders' --write
  bun verify browser goto /
  bun verify browser click --role button --name 'Place order'
  bun verify browser snapshot
  ```

- **End state:** the snapshot's heading starts with `The order failed`.

<!-- /repo -->

## Keep the map true

<!-- repo: registry -->

The registry,
[`create-shop-registry.ts`](../../../packages/shop-example/src/create-shop-registry.ts), declares
the targets, actions, commands, doctor checks and features, with each feature's `paths`.

<!-- /repo -->

- When a change touches a file under a feature's `paths`, drive that feature and run `done` before
  the PR.
- When a journey no longer works because the feature changed, fix the journey in the same PR.
- Run `bun verify lint` after you change this skill or the registry. It fails on a `paths` glob that
  matches no file, a command in a code block that would not parse, and a skill written from an older
  template.

**Reply:** the output of `bun verify report --human`, and each feature you could not verify, with
the command that failed and its `error.code`.
