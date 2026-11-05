<div align="center">
  <h1>@wringer/http</h1>

  <p>
    <a href="https://www.npmjs.com/package/@wringer/http"><img src="https://img.shields.io/npm/v/@wringer/http" alt="npm version"></a>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  </p>
</div>

The http driver for wringer: it sends requests to a target's app and keeps each response as
evidence.

## Install

```bash
bun add @wringer/core @wringer/http
```

The package runs on [Bun](https://bun.sh) 1.3 or newer.

## Usage

Add the driver to the registry, then give each target its config:

```ts
import { createWringer, local } from '@wringer/core';
import { http } from '@wringer/http';

export const registry = createWringer({ name: 'shop' })
  .use(http({ timeoutMs: 10_000 }))
  .target('prod', {
    mode: 'attach',
    access: 'read-only',
    host: local(),
    endpoints: () => ({ web: 'https://shop.example' }),
    drivers: { http: () => ({ readOnly: { allow: [{ method: 'POST', path: '/api/search' }] } }) },
  })
  .build();
```

An action calls `ctx.drivers.http.request({ method, path, headers, json })`. The CLI adds
`http request --path /api/cart`, which takes the JSON body as `--body`, because the CLI's `--json`
picks the output. It also adds the doctor check `http.reachable`. A JSON body on a GET or HEAD
request fails with a usage error before the driver sends it.

## Target config

| Field        | Default | Meaning                                                     |
| ------------ | ------- | ----------------------------------------------------------- |
| `endpoint`   | `web`   | The run endpoint whose URL the paths join.                  |
| `baseURL`    | none    | A URL to use in place of the endpoint.                      |
| `healthPath` | `/`     | The path the doctor checks; a 5xx answer fails the check.   |
| `readOnly`   | none    | `allow`: the method and path globs a read-only target runs. |

GET, HEAD and OPTIONS are reads. A read-only target refuses any other method with exit code 3 and
the target's hint, unless `readOnly.allow` lists that method and path. The driver never follows a
redirect: it returns the 3xx response, so a granted request never reaches a path the target did not
grant.
