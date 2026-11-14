# Changelog

## [0.1.4](https://github.com/zgeoff/wringer/compare/@wringer/db@0.1.3...@wringer/db@0.1.4) (2026-11-14)

### Dependencies

- The following workspace dependencies were updated
  - devDependencies
    - @wringer/core bumped to 0.3.1
  - peerDependencies
    - @wringer/core bumped to 0.3.1

## [0.1.3](https://github.com/zgeoff/wringer/compare/@wringer/db@0.1.2...@wringer/db@0.1.3) (2026-11-14)

### Features

- take zod as a peer dependency in the published packages
  ([5d62c6d](https://github.com/zgeoff/wringer/commit/5d62c6def83a06c8be284967928dc3286099e92b)),
  closes [#130](https://github.com/zgeoff/wringer/issues/130)

### Bug Fixes

- **db:** bound a postgres connect and cancel on a stalled server
  ([2dcb3cb](https://github.com/zgeoff/wringer/commit/2dcb3cbc8040fb8f8b717465ce6c181b13bcf4ac)),
  closes [#133](https://github.com/zgeoff/wringer/issues/133)
- **db:** fall back to one more timeout when round trips jitter
  ([5daf26f](https://github.com/zgeoff/wringer/commit/5daf26f835217a7e296397222d38a96ffda518a7)),
  closes [#132](https://github.com/zgeoff/wringer/issues/132)
- **db:** return sqlite integers beyond 2^53 as their digits
  ([1751b3a](https://github.com/zgeoff/wringer/commit/1751b3aefa15283427f2c16fee62bf8b404fdc99)),
  closes [#129](https://github.com/zgeoff/wringer/issues/129)

### Dependencies

- The following workspace dependencies were updated
  - devDependencies
    - @wringer/core bumped to 0.3.0
  - peerDependencies
    - @wringer/core bumped to 0.3.0

## [0.1.2](https://github.com/zgeoff/wringer/compare/@wringer/db@0.1.1...@wringer/db@0.1.2) (2026-11-12)

### Dependencies

- The following workspace dependencies were updated
  - devDependencies
    - @wringer/core bumped to 0.2.0
  - peerDependencies
    - @wringer/core bumped to 0.2.0

## [0.1.1](https://github.com/zgeoff/wringer/compare/@wringer/db@0.1.0...@wringer/db@0.1.1) (2026-11-08)

### Dependencies

- The following workspace dependencies were updated
  - devDependencies
    - @wringer/core bumped to 0.1.2
  - peerDependencies
    - @wringer/core bumped to 0.1.2

## 0.1.0 (2026-11-07)

### Features

- **http,db:** add the http and db drivers ([#37](https://github.com/zgeoff/wringer/issues/37))
  ([08c18ae](https://github.com/zgeoff/wringer/commit/08c18ae620f8f0a88a85aa79e75df0262354503b))

### Dependencies

- The following workspace dependencies were updated
  - devDependencies
    - @wringer/core bumped to 0.1.1
  - peerDependencies
    - @wringer/core bumped to 0.1.1
