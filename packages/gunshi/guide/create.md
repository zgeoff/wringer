# Create

Write the verify CLI, its registry and the repo's verify skill

Add the verify CLI, its
[registry](https://github.com/zgeoff/wringer/blob/main/docs/reference/terms.md#registry) and the
repo's `verify` skill. `verify-registry.ts` in the template shows one target, driver, action, repo
command, doctor check and feature, on the builder that `createWringer` returns.

The mistakes that cost the most:

- **Leaving a read unmarked.** A repo command is a write unless it declares `effect: 'read'`, and an
  action must declare its effect. A read-only target refuses each write with exit code 3.
- **A glob relative to a package.** Write each feature's `paths` globs relative to the repo root, as
  `git ls-files` prints paths. In a monorepo, a glob relative to a package folder matches nothing.
- **Ignoring a file that changes behaviour.** Ignore only files the running app never reads, such as
  docs and tests. The gate skips a file that an ignore glob matches, even when a feature's `paths`
  match it too, so a change to it never needs a verdict.
- **A placeholder in a journey.** In the `verify` skill's fenced code blocks, `bun verify lint`
  parses each line that starts with `bun verify`, and reads `<name>` as a shell redirect. Write each
  such line as a command that runs, and put a command with a placeholder in inline code.
- **Matching a plain-text ready line as a string.** The launch target's `ready` function gets a JSON
  object line as that object, and any other line as `{ message: <the line> }`. Match plain text on
  `line['message']`.

## Steps

1. Install each driver the app needs, at an exact version, such as
   `bun add --dev --exact @wringer/http`. Expect: each one in `devDependencies`.

   | Driver              | Drives                                       |
   | ------------------- | -------------------------------------------- |
   | `@wringer/browser`  | a page, through its accessibility tree       |
   | `@wringer/http`     | the app's HTTP API                           |
   | `@wringer/db`       | SQL on the app's SQLite or Postgres database |
   | `@wringer/stream`   | the app's logs, recorded for the whole run   |
   | `@wringer/terminal` | a text program, through its screen           |
   | `@wringer/mcp`      | the tools of an MCP server                   |

   Each driver adds its own commands and its own doctor check. Its README in `node_modules/` gives
   its config for a target.

2. Add `.wringer/` to `.gitignore`. The CLI keeps each run's state and evidence there.
3. Copy `verify.ts` and `verify-registry.ts` from the template (`bun verify guide template` names
   its folder) into `scripts/verify/`. Add `"verify": "bun scripts/verify/verify.ts"` to the
   `scripts` of `package.json`. Expect: `bun verify --help` lists the template's commands.
4. In `verify-registry.ts`, write the `local` target with `mode: 'launch'` and
   `access: 'read-write'`. Its `launch` function returns:
   - `command`: the command a developer runs to start the app;
   - `env`: the app's environment. Point the app's state at `ctx.runDirectory` here, such as a
     SQLite file, so each run starts clean. For a database server, name a database per run;
   - `ready`: a function that returns the app's endpoints once a line shows the app is ready, such
     as `{ web: 'http://127.0.0.1:4100' }`, and `null` before. The drivers use the `web` endpoint
     unless a driver's config sets another `endpoint`.
5. Write a target with `mode: 'attach'` for each instance that runs apart from the CLI, such as a
   staging or a production deployment. Its `endpoints` function returns the instance's URLs. Give a
   target `access: 'read-only'` when agents must never write there, such as production, and a
   `refusalHint` that tells the agent where to report a write it needed.
6. Under each target's `drivers`, give a config for each driver the target allows. A target with no
   config for a driver refuses that driver's commands.
7. Write an action with `.action` for each setup step a journey needs and a user can't do quickly in
   the app, such as seeding a record. The CLI runs it as `bun verify action <name>`.
8. Write a repo command with `.command` for a read that a journey checks, such as a count.
9. Write a doctor check with `.check` for each thing that must hold before a journey means anything,
   such as an API that answers. Then run `bun verify up`, then `bun verify doctor`. Expect:
   `data.passed: true`. Run `bun verify down`.
10. Write 3 to 5 features with `.feature`, each with `name`, `summary` and `paths`. Pick the
    journeys users take most, from the app's routes and its README, and give each feature the globs
    of the files that change its behaviour.
11. The gate fails a PR that changes a file matched by neither a feature's `paths` nor an ignore
    glob. Call `.ignore` with the globs of the files the running app never reads, such as `docs/**`,
    `**/*.md`, `**/*.test.ts`, `.github/**` and `.claude/**`. Add each other file to the `paths` of
    each feature whose behaviour it changes: a file such as `package.json` changes every feature.
    Call `.shared` with the globs of the files that change every feature, such as the registry's own
    folder, because `lint` fails a registry file that no shared glob or `paths` glob matches.
    Expect: each file that `git ls-files` prints matches a feature's `paths` or an ignore glob.
12. Copy `verify/` from the template to `.claude/skills/verify/`. Rewrite the frontmatter's `name`
    and `description` and the `#` title for the app. Set `metadata.wringer-command` to the command
    that runs the script, `bun verify` by default. Rewrite each `<!-- repo: <part> -->` block:
    - `targets`: one row per target, with the command that starts a run, and what to do on a
      refusal.
    - `commands`: what `--help` can't say about the actions and repo commands, such as the order to
      run them in.
    - `registry`: the path of the registry file.

    Then delete `references/feature-add-item.md` and write one `references/feature-<name>.md` per
    feature, in the template's form: what it does, how a user reaches it, a `## Journey` section
    whose first `bash` block starts with `bun verify use --feature <name>` and runs as written, and
    a `## End state` section. Replace the feature table between the `wringer:features` markers with
    the output of `bun verify features --markdown`.

13. Run `bun verify lint`. Expect: `ok: true`, and `data.commands`, the count of journey lines it
    parsed, above 0. A count of 0 means it found no journey.
14. Run `bun verify --help`, then `bun verify <group> --help` for each group it lists, such as
    `action`. Expect: every action and repo command, each marked `[read]` or `[write]`.
