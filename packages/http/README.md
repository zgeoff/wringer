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

`http()` takes `timeoutMs`, 30 seconds by default, and `transport`, a function of a `URL` and its
`RequestInit` that returns a `Response`. The driver sends each request through `transport`, which is
`fetch` unless the repo passes its own.

## Redaction

The driver redacts each exchange before it leaves: in the evidence file, in the `http request`
command's data and in every error message. An action or a check still gets the real response.

- Headers: `authorization`, `proxy-authorization`, `cookie`, `set-cookie`, `x-api-key`, and any
  header whose name holds `token`, `secret`, `apikey`, `session` or `passw`. Each cookie keeps its
  name and loses its value.
- Query parameters: `token`, `access_token`, `id_token`, `api_key`, `apikey`, `key`, `secret`,
  `password`, `sig` and `code`.
- JSON body paths, in the request and the response, that the repo names.

```ts
http({
  redact: {
    headers: ['x-shop-session'], // added to the default list, any case
    query: ['signature'], // added to the default list
    bodyPaths: ['$.customer.card', '$.items[*].coupon'], // `$`, then `.name` or `[*]` steps
  },
});
```

Each value it redacts joins core's secret set, so a copy of it anywhere else in a run is scrubbed
too. A request that sets `evidence: false` writes no evidence file. The driver refuses a request
whose URL holds a username or a password: send credentials as a header.

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
