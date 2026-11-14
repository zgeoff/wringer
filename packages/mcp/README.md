<div align="center">
  <h1>@wringer/mcp</h1>

  <p>
    <a href="https://www.npmjs.com/package/@wringer/mcp"><img src="https://img.shields.io/npm/v/@wringer/mcp" alt="npm version"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  </p>
</div>

The MCP driver for wringer: it calls the tools of the MCP servers that a target names, over stdio or
Streamable HTTP, and keeps each result as evidence.

## Install

```bash
bun add @wringer/core @wringer/mcp
```

## Usage

```ts
import { createWringer, local } from '@wringer/core';
import { mcp } from '@wringer/mcp';

export const registry = createWringer({ name: 'shop' })
  .use(mcp({}))
  .target('local', {
    mode: 'attach',
    access: 'read-only',
    host: local(),
    drivers: {
      mcp: ({ endpoints }) => ({
        servers: {
          atc: {
            transport: 'http',
            url: `${endpoints['mcp']}/mcp`,
            auth: {
              clientCredentials: {
                clientID: 'service:wringer-ro',
                secretEnv: 'ATC_MCP_SECRET',
                scope: 'read',
              },
            },
            readTools: ['atc_sessions_list', 'atc_session_get'],
          },
          local: { transport: 'stdio', command: ['bun', 'src/mcp.ts'], readTools: [] },
        },
      }),
    },
  })
  .build();
```

The target names each server, so an agent never passes a URL or a command line.

| Key                             | Meaning                                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------------------------- |
| `transport`                     | `http` for Streamable HTTP, or `stdio` for a child process.                                        |
| `url`                           | The MCP endpoint of an `http` server.                                                              |
| `auth.clientCredentials`        | OAuth client_credentials with client_secret_basic. `secretEnv` names the variable with the secret. |
| `auth.clientCredentials.issuer` | The authorization server the credentials are for. They go to no other. Set it.                     |
| `auth.bearerEnv`                | The variable that holds a bearer token. Leave `auth` out for a server with no sign-in.             |
| `command`, `env`, `cwd`         | A `stdio` server's argv, its added environment and its working folder.                             |
| `readTools`                     | The only tools a read-only target may call.                                                        |

A `stdio` child gets a minimal environment plus `env`, not the supervisor's. Its `cwd` starts at the
folder where the run's supervisor runs. The driver reads `secretEnv` and `bearerEnv` from the
environment of the supervisor, which is the shell that ran `up` or `attach`.

## Commands

| Command                                          | Effect                          | Answer                                                                  |
| ------------------------------------------------ | ------------------------------- | ----------------------------------------------------------------------- |
| `mcp tools [--server <s>]`                       | read                            | `{ server, tools: [{ name, description, readOnlyHint, inReadTools }] }` |
| `mcp call <tool> [--args <json>] [--server <s>]` | read in `readTools`, else write | `{ server, tool, isError, content, structuredContent }`                 |

`--server` is optional while the target names one server, and a `usage` error while it names
several. `--args` is a JSON object, and a malformed one is a `usage` error.

- A tool that returns `isError: true` still answers `ok: true`, with `isError` in `data`, as
  `http request` does for any status.
- A failure of the transport or the protocol is an error envelope: `environment` for a server that
  is down or rejects the credentials, `timeout` for a call past its deadline, and `check-failed` for
  a request that the server refuses, such as an unknown tool.
- `mcp call` writes `call-<tool>.json` as evidence, with the server, tool, args and result.
- The run's supervisor keeps one connected client for each server. `detach` and `down` end each HTTP
  session with a `DELETE` and stop each `stdio` child.

## Read-only targets

A tool is a read only when `readTools` lists it. The driver ignores the server's own `readOnlyHint`,
which `mcp tools` shows for reference. A read-only target refuses `mcp call` of any other tool with
exit code 3 before any request leaves. `mcp tools` still runs.

## Secrets

The client secret, the `Authorization` header value that carries it, each access token and each
bearer value join the command's secrets before the driver writes any evidence. The envelope and
every evidence file then hold `[redacted:<name>]` in their place. The driver never writes a request
header to evidence.
