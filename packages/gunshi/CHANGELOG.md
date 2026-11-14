# Changelog

## [0.3.0](https://github.com/zgeoff/wringer/compare/@wringer/gunshi@0.2.0...@wringer/gunshi@0.3.0) (2026-11-14)

### ⚠ BREAKING CHANGES

- **core:** scrub every known secret at the sinks
- **gunshi:** serve the guide from the cli and drop skill install

### Features

- **core:** add a rest port for pull request descriptions
  ([ef0ed06](https://github.com/zgeoff/wringer/commit/ef0ed067dfe4bbfb1f71973d2b36dd4323deb3e4)),
  closes [#111](https://github.com/zgeoff/wringer/issues/111)
- **core:** fail lint when no glob covers the registry file
  ([1aab324](https://github.com/zgeoff/wringer/commit/1aab32402d978c71d0d66a264b65bb726365e52b)),
  closes [#107](https://github.com/zgeoff/wringer/issues/107)
- **core:** scope each verdict to its own feature's files
  ([597a5f4](https://github.com/zgeoff/wringer/commit/597a5f41259b6e80cca83ee6fdfd7a97236e00cf)),
  closes [#104](https://github.com/zgeoff/wringer/issues/104)
- **core:** scrub every known secret at the sinks
  ([6c14eb0](https://github.com/zgeoff/wringer/commit/6c14eb05cfb599a4e156d8df04259ba1c19e206b)),
  closes [#108](https://github.com/zgeoff/wringer/issues/108)
- **core:** upload evidence through a generic file-host uploader
  ([cdf222e](https://github.com/zgeoff/wringer/commit/cdf222eb19a822ddf1ad415b0496e192e8e893db)),
  closes [#112](https://github.com/zgeoff/wringer/issues/112)
- **gunshi:** lint the skill shape, the feature table and every glob
  ([3dd1bbf](https://github.com/zgeoff/wringer/commit/3dd1bbf8407142cf25d74fe048cc31b4de3f9732)),
  closes [#121](https://github.com/zgeoff/wringer/issues/121)
- **gunshi:** replace the template version with a content hash
  ([6be8dad](https://github.com/zgeoff/wringer/commit/6be8dadcafa074db88f6583f7de6f8fb5738e497)),
  closes [#123](https://github.com/zgeoff/wringer/issues/123)
- **gunshi:** serve the guide from the cli and drop skill install
  ([28bce50](https://github.com/zgeoff/wringer/commit/28bce50f887cbc5129b72b1abbf870e6c52d124c)),
  closes [#122](https://github.com/zgeoff/wringer/issues/122)
- **scripts:** add a check that a pr carries a passing wringer report
  ([df0a7ce](https://github.com/zgeoff/wringer/commit/df0a7ce3701454d4c502c0b2a34079287477ba2c)),
  closes [#117](https://github.com/zgeoff/wringer/issues/117)
- take zod as a peer dependency in the published packages
  ([5d62c6d](https://github.com/zgeoff/wringer/commit/5d62c6def83a06c8be284967928dc3286099e92b)),
  closes [#130](https://github.com/zgeoff/wringer/issues/130)
- **terminal:** add the terminal driver ([#147](https://github.com/zgeoff/wringer/issues/147))
  ([c6c98c1](https://github.com/zgeoff/wringer/commit/c6c98c1f35d90261527124a89c43f4abea9d898e))

### Bug Fixes

- **gunshi:** restore the cli guide that a bad squash reverted
  ([4ad5051](https://github.com/zgeoff/wringer/commit/4ad5051f4e4bc1ec7ef848c7a0de2c433b6f4966))

### Dependencies

- The following workspace dependencies were updated
  - devDependencies
    - @wringer/core bumped to 0.3.0
    - @wringer/http bumped to 0.1.3
  - peerDependencies
    - @wringer/core bumped to 0.3.0

## [0.2.0](https://github.com/zgeoff/wringer/compare/@wringer/gunshi@0.1.1...@wringer/gunshi@0.2.0) (2026-11-12)

### ⚠ BREAKING CHANGES

- **core:** ignore no-effect paths and fail the gate on unmapped ones
  ([#99](https://github.com/zgeoff/wringer/issues/99))

### Features

- **core:** ignore no-effect paths and fail the gate on unmapped ones
  ([#99](https://github.com/zgeoff/wringer/issues/99))
  ([c781102](https://github.com/zgeoff/wringer/commit/c7811021a3b6eaaebd8e7dbcf65639315d85acf6))

### Dependencies

- The following workspace dependencies were updated
  - devDependencies
    - @wringer/core bumped to 0.2.0
    - @wringer/http bumped to 0.1.2
  - peerDependencies
    - @wringer/core bumped to 0.2.0

## [0.1.1](https://github.com/zgeoff/wringer/compare/@wringer/gunshi@0.1.0...@wringer/gunshi@0.1.1) (2026-11-08)

### Features

- **gunshi:** add the build skill, its template and a lint command
  ([#80](https://github.com/zgeoff/wringer/issues/80))
  ([fa40f43](https://github.com/zgeoff/wringer/commit/fa40f434238b5548beedc2d1665665349588587c))

### Dependencies

- The following workspace dependencies were updated
  - devDependencies
    - @wringer/core bumped to 0.1.2
    - @wringer/http bumped to 0.1.1
  - peerDependencies
    - @wringer/core bumped to 0.1.2

## 0.1.0 (2026-11-07)

### Features

- **gunshi:** add the verify cli adapter ([#35](https://github.com/zgeoff/wringer/issues/35))
  ([ecd78dd](https://github.com/zgeoff/wringer/commit/ecd78ddaeeb2ddc5a033ea5b54038027b8779a7e))

### Dependencies

- The following workspace dependencies were updated
  - devDependencies
    - @wringer/core bumped to 0.1.1
  - peerDependencies
    - @wringer/core bumped to 0.1.1
