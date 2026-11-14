# Changelog

## [0.3.0](https://github.com/zgeoff/wringer/compare/@wringer/core@0.2.0...@wringer/core@0.3.0) (2026-11-14)

### ⚠ BREAKING CHANGES

- **core:** write and gate the version 2 data comment
- **core:** scrub every known secret at the sinks

### Features

- **core:** add a rest port for pull request descriptions
  ([ef0ed06](https://github.com/zgeoff/wringer/commit/ef0ed067dfe4bbfb1f71973d2b36dd4323deb3e4)),
  closes [#111](https://github.com/zgeoff/wringer/issues/111)
- **core:** add a writer for the report span of a pr description
  ([509c686](https://github.com/zgeoff/wringer/commit/509c6863eb65055a36dcab543114d8ea0680f11a)),
  closes [#110](https://github.com/zgeoff/wringer/issues/110)
- **core:** fail lint when no glob covers the registry file
  ([1aab324](https://github.com/zgeoff/wringer/commit/1aab32402d978c71d0d66a264b65bb726365e52b)),
  closes [#107](https://github.com/zgeoff/wringer/issues/107)
- **core:** list the features with their files from the cli
  ([e30234b](https://github.com/zgeoff/wringer/commit/e30234b7f78409f191d6866a25b57d813ff2ea7e)),
  closes [#120](https://github.com/zgeoff/wringer/issues/120)
- **core:** pin verdicts on a deployed target to its commit
  ([c1c53c2](https://github.com/zgeoff/wringer/commit/c1c53c2af964edfd5ed1db2f41c8e7fbd8cd05f2)),
  closes [#106](https://github.com/zgeoff/wringer/issues/106)
- **core:** plan the report's size within the comment budget
  ([63f611c](https://github.com/zgeoff/wringer/commit/63f611cba36097d80d090d10d8553d1bbb421c1e)),
  closes [#114](https://github.com/zgeoff/wringer/issues/114)
- **core:** publish the report into the pull request description
  ([ac4c455](https://github.com/zgeoff/wringer/commit/ac4c455f5c9600cb00b49aa4a2d739df78aadde6)),
  closes [#115](https://github.com/zgeoff/wringer/issues/115)
- **core:** read the changed paths and every fingerprint from one diff
  ([580bd96](https://github.com/zgeoff/wringer/commit/580bd96fc3fcfcba3890d4ab0c92f054503c17bb)),
  closes [#103](https://github.com/zgeoff/wringer/issues/103)
- **core:** render the journey report with no upload
  ([73e0183](https://github.com/zgeoff/wringer/commit/73e0183aaa05f5be8a9cc94897a33f03b5b642f8)),
  closes [#113](https://github.com/zgeoff/wringer/issues/113)
- **core:** scope each verdict to its own feature's files
  ([597a5f4](https://github.com/zgeoff/wringer/commit/597a5f41259b6e80cca83ee6fdfd7a97236e00cf)),
  closes [#104](https://github.com/zgeoff/wringer/issues/104)
- **core:** scrub every known secret at the sinks
  ([6c14eb0](https://github.com/zgeoff/wringer/commit/6c14eb05cfb599a4e156d8df04259ba1c19e206b)),
  closes [#108](https://github.com/zgeoff/wringer/issues/108)
- **core:** upload evidence through a generic file-host uploader
  ([cdf222e](https://github.com/zgeoff/wringer/commit/cdf222eb19a822ddf1ad415b0496e192e8e893db)),
  closes [#112](https://github.com/zgeoff/wringer/issues/112)
- **core:** write and gate the version 2 data comment
  ([b67decf](https://github.com/zgeoff/wringer/commit/b67decfe5401ba82ea663dd2b665ace26624955b)),
  closes [#105](https://github.com/zgeoff/wringer/issues/105)
- **scripts:** add a check that a pr carries a passing wringer report
  ([df0a7ce](https://github.com/zgeoff/wringer/commit/df0a7ce3701454d4c502c0b2a34079287477ba2c)),
  closes [#117](https://github.com/zgeoff/wringer/issues/117)
- take zod as a peer dependency in the published packages
  ([5d62c6d](https://github.com/zgeoff/wringer/commit/5d62c6def83a06c8be284967928dc3286099e92b)),
  closes [#130](https://github.com/zgeoff/wringer/issues/130)
- **verify:** write wringer's own verify skill
  ([c5cdb44](https://github.com/zgeoff/wringer/commit/c5cdb44842f0b41c88d1ff7e678b073a6b28f704)),
  closes [#124](https://github.com/zgeoff/wringer/issues/124)

### Bug Fixes

- **core:** fail up and attach when the supervisor exits before ready
  ([e7c602f](https://github.com/zgeoff/wringer/commit/e7c602f83c5d61af1fc060b1711ab522ac73bc34)),
  closes [#128](https://github.com/zgeoff/wringer/issues/128)
- **core:** release the app's output pipes when a stop gives up on them
  ([3c7c699](https://github.com/zgeoff/wringer/commit/3c7c699047c5d0854cb8ed0ea02aaa7043354f40)),
  closes [#127](https://github.com/zgeoff/wringer/issues/127)
- **core:** retry the removal of a test repo while late work writes
  ([b476aa4](https://github.com/zgeoff/wringer/commit/b476aa4872b9b86e70a43dd84707210046e36d5d)),
  closes [#135](https://github.com/zgeoff/wringer/issues/135)
- **core:** treat eperm on a macos group kill as a group that is gone
  ([47e65c4](https://github.com/zgeoff/wringer/commit/47e65c460e4d3493be3bd3079baa6fbb2ae407ca)),
  closes [#131](https://github.com/zgeoff/wringer/issues/131)

## [0.2.0](https://github.com/zgeoff/wringer/compare/@wringer/core@0.1.2...@wringer/core@0.2.0) (2026-11-12)

### ⚠ BREAKING CHANGES

- **core:** ignore no-effect paths and fail the gate on unmapped ones
  ([#99](https://github.com/zgeoff/wringer/issues/99))

### Features

- **core:** ignore no-effect paths and fail the gate on unmapped ones
  ([#99](https://github.com/zgeoff/wringer/issues/99))
  ([c781102](https://github.com/zgeoff/wringer/commit/c7811021a3b6eaaebd8e7dbcf65639315d85acf6))

## [0.1.2](https://github.com/zgeoff/wringer/compare/@wringer/core@0.1.1...@wringer/core@0.1.2) (2026-11-08)

### Features

- **gunshi:** add the build skill, its template and a lint command
  ([#80](https://github.com/zgeoff/wringer/issues/80))
  ([fa40f43](https://github.com/zgeoff/wringer/commit/fa40f434238b5548beedc2d1665665349588587c))

## [0.1.1](https://github.com/zgeoff/wringer/compare/@wringer/core@0.1.0...@wringer/core@0.1.1) (2026-11-07)

### Features

- **core:** add the envelope, run state, fingerprint and exec hosts
  ([#33](https://github.com/zgeoff/wringer/issues/33))
  ([efe485a](https://github.com/zgeoff/wringer/commit/efe485a92c127ae33b084eb787854f95d518af2b))
- **core:** add the registry, read-only targets, supervisor and commands
  ([#34](https://github.com/zgeoff/wringer/issues/34))
  ([9cdd3e5](https://github.com/zgeoff/wringer/commit/9cdd3e5d50733dc7b94e074af8ebfc5c78b9dce9))
- **gunshi:** add the verify cli adapter ([#35](https://github.com/zgeoff/wringer/issues/35))
  ([ecd78dd](https://github.com/zgeoff/wringer/commit/ecd78ddaeeb2ddc5a033ea5b54038027b8779a7e))
- **stream,browser:** add the stream and browser drivers
  ([#38](https://github.com/zgeoff/wringer/issues/38))
  ([88ed290](https://github.com/zgeoff/wringer/commit/88ed290d40bea5e68ccbfc2fc836cb03224a8089))

## 0.1.0 (2026-10-31)

### Features

- set up the workspace toolchain and the core package
  ([#1](https://github.com/zgeoff/wringer/issues/1))
  ([8a3cc07](https://github.com/zgeoff/wringer/commit/8a3cc0750e7633911e55c488c23cb4dddb03f98d))
