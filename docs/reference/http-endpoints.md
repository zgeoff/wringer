# HTTP endpoints and requests without the session

The `@wringer/http` driver sends each request to one endpoint of the target. A target's config can
name more endpoints, such as an admin API beside the main one, and a request can go without the
session, to show that the app refuses it.

## Endpoints

The target's `endpoint` field names its default endpoint, `web` unless you set it. The `endpoints`
field sets the health check of a named endpoint. Each named endpoint takes its address from the
target's own `endpoints` map.

An entry of the target's map that the driver config doesn't name is a named endpoint too, with the
default health path and the session. The one exception is an entry whose address is not an `http` or
`https` URL, such as a database file: the doctor doesn't probe it, and `http request` refuses it as
an unknown endpoint.

```ts
drivers: {
  http: () => ({
    healthAuth: true,
    endpoints: { admin: { healthPath: '/api/health', healthAuth: false } },
    readOnly: {
      allow: [
        { method: 'POST', path: '/api/search' },
        { method: 'POST', path: '/api/audit', endpoint: 'admin' },
      ],
    },
  }),
},
```

| Field                         | Default | Meaning                                                                       |
| ----------------------------- | ------- | ----------------------------------------------------------------------------- |
| `healthAuth`                  | `true`  | Whether the doctor check sends the session to the default endpoint.           |
| `endpoints.<name>.healthPath` | `/`     | The path the doctor requests on that endpoint.                                |
| `endpoints.<name>.healthAuth` | `true`  | Whether the doctor check sends the session to that endpoint.                  |
| `readOnly.allow[].endpoint`   | default | The endpoint a grant covers. A grant with no endpoint covers the default one. |

`baseURL` replaces the address of the default endpoint only. A named endpoint always takes its
address from the target's `endpoints` map.

## Requests

`http request` takes two flags, and an action's `request` call takes the same two fields, `endpoint`
and `auth`.

- `--endpoint <name>` sends the request to the default endpoint or to a named one. A name that is
  neither fails with a `usage` error that lists the names that exist.
- `--no-auth` sends the request without the session.

The doctor check `http.reachable` requests the default endpoint and each named endpoint at its own
`healthPath`. It sends the session unless that endpoint's `healthAuth` is `false`. A failure names
the endpoint when it is not the default.

Each request's evidence file holds `endpoint` and `auth` beside `request` and `response`.

## The transport and the session

The driver never adds the session. A repo's transport does, and the driver tells it what to do
through a third argument of type `HttpTransportRoute`:

```ts
http({
  transport: async (url, init, route) => {
    const headers = new Headers(init.headers);

    if (route.auth) {
      headers.set('cookie', await readSessionCookie(route.endpoint));
    }

    return fetch(url, { ...init, headers });
  },
});
```

A transport that declares two parameters stays valid, and it receives no route. When a request has
`--no-auth`, or any `healthAuth` in the config is `false`, the driver refuses a transport that
declares fewer than three parameters. It fails with a `usage` error before it sends anything, and
the hint says to declare the third parameter.

The driver reads the count from `Function.length`. A transport written with rest parameters, or with
a default value on its third parameter, has a shorter `length`, and the driver refuses it. Declare
`route` as a plain third parameter.
