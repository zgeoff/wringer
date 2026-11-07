# Create

- `ready` gets each line the launched app prints to stdout. A JSON object line arrives as that
  object, and any other line as `{ message: <the line> }`. Return the endpoints once the app is
  ready, such as `{ web: 'http://127.0.0.1:4100' }`; return `null` until then. The drivers use the
  `web` endpoint unless a target's driver config sets another.
- Every action and command is a write unless it declares `effect: 'read'`. A read-only target
  refuses each write with exit code 3, so mark each read as a read.
- `paths` globs are relative to the repo root, as git lists files. A glob relative to a package
  folder matches nothing in a monorepo.
- A journey line in the `verify` skill must run as written. `lint` parses each line of a fenced code
  block that calls the CLI, and a placeholder such as `<name>` reads as a shell redirect. Put a
  command with a placeholder in inline code.
- wringer keeps its state and evidence in `.wringer/` at the repo root. Git must ignore it.

## Steps

1. Install the drivers the app needs, at exact versions:

   | Driver             | Drives                                       |
   | ------------------ | -------------------------------------------- |
   | `@wringer/browser` | a page, through its accessibility tree       |
   | `@wringer/http`    | the app's HTTP API                           |
   | `@wringer/db`      | SQL on the app's SQLite or Postgres database |
   | `@wringer/stream`  | the app's logs, recorded for the whole run   |

   Each driver adds its own commands and a doctor check. Its README in `node_modules/` gives its
   target config.

2. Add `.wringer/` to `.gitignore`.
3. Copy `template/verify.ts` and `template/verify-registry.ts` into `scripts/verify/`. Add the
   script to `package.json`: `"verify": "bun scripts/verify/verify.ts"`.
4. Write the `local` target: `mode: 'launch'`, `access: 'read-write'`, and the command a developer
   runs to start the app. Point the app's state at `ctx.runDirectory`, such as a database file, so
   each run starts clean.
5. Write an attach target for each running instance that agents may check, such as a staging or a
   production deployment. Give a production target `access: 'read-only'` and a `refusalHint` that
   tells the agent where to report a write it needed.
6. Give each target a config for each driver it allows, under `drivers`. A target with no config for
   a driver refuses that driver's commands.
7. Write an action for each setup step a journey needs and a user can't do quickly in the app, such
   as seeding a record.
8. Write a repo command with `.command` for a read that a journey checks often, such as a count. The
   CLI lists it in `--help` with its summary.
9. Write a doctor check with `.check` for each thing that must hold before a drive means anything,
   such as an API that answers or a migration that ran.
10. Write 3 to 5 features with `.feature`. Pick the journeys users take most, and give each feature
    the globs of the files that change its behaviour.
11. Copy `template/verify/` to `.claude/skills/verify/`. Rewrite the frontmatter's `name` and
    `description` for the app, and set `metadata.wringer-command`. Rewrite each `<!-- repo -->`
    block:
    - `targets`: one row per target, with the command that starts a run and what to do on a refusal.
    - `commands`: what `--help` can't say about the repo commands and actions, such as the order to
      run them in.
    - `features`: one `###` entry per feature, in the template's form: what it is, how a user
      reaches it, the commands that drive it, and the end state that proves it works.
12. Run `bun verify lint`. Expect: `ok: true`, and `data.commands` counts the journey lines.
13. Run `bun verify --help`. Expect: every action and repo command, each marked `[read]` or
    `[write]`.
