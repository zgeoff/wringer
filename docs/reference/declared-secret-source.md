# Declared secret source

`runVerify(registry, { env })` takes the values of the registry's `.secret('NAME')` names from a
source. Without `env`, every command reads each declared name from the process env, so a repo that
keeps its secrets in a store must export them into the shell first.

```ts
await runVerify(registry, {
  env: async (signal) => ({ SHOP_API_TOKEN: await readFromStore('shop-api-token', signal) }),
});
```

`env` is a record of names to string values, or a function that gets an `AbortSignal` and returns
such a record, sync or async. The types are `DeclaredSecretSource` and `DeclaredSecretValues`.

## Rules

- `up` and `attach` call the source once, after the run ID exists and before the supervisor starts,
  and only when the registry declares a secret. The signal aborts at the command's deadline.
- Each non-empty declared value goes into the run's secrets file, which only its owner can read,
  with the origin `declared`. A record with no origin counts as `collected`.
- With a source, a command that has a run reads the declared values from that file, not from the
  process env. The run's supervisor does the same, and fails with `environment` when the file can't
  be read. A command with no run, such as `doctor` before `up`, still reads the process env.
- A source that throws fails with `environment` and starts no run. The message names only the
  error's class, as its text may hold a secret.
- A result that is not a record of string values fails with `environment`.
- A declared name that the result leaves out or leaves empty is skipped. A value under 8 characters
  fails with `usage`, as it does from the process env.
- The values only join the secret set that scrubs evidence, the envelope and the run log. They never
  reach the app's environment.
