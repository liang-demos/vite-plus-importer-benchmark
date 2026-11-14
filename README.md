# Vite+ importer benchmark

Experiment for [vite-plus#3380](https://github.com/voidzero-dev/vite-plus/issues/3380).
Uses the existing oxnode module runner exposed as `vite-plus/importer` by the
[POC branch](https://github.com/liangmiQwQ/vite-plus/tree/liang/codex/3380-oxc-native-config-poc).

## Reproduce

Build that branch following Vite+'s CONTRIBUTING.md (`just init`, `just build`).
For an already-built checkout, rebuild the native binding and then JavaScript:

```sh
pnpm -F vite-plus build-native
pnpm -F vite-plus build-ts
```

In this repository, use Node 24.22.3 (the checked-in `.node-version`).
`vp node` selects it; plain `node` works too when it is already that version:

```sh
pnpm install --frozen-lockfile
vp node setup.mjs /absolute/path/to/vite-plus
vp node bench.mjs --samples=2 --warm=2
vp node bench.mjs
```

Setup stages built CLI/core JavaScript in real `node_modules` directories and links
their dependencies to the checkout installation. It avoids treating a symlinked
Vite+ checkout as local TypeScript source, which would distort importer timings.
Re-run setup after rebuilding the POC. The importer has no registry release yet.
`node bench.mjs --samples=30 --warm=30` changes the default 20 samples per case.
Run from this repository's root, on an idle machine, after builds finish.

## What is measured

| Mode          | API                                      | Cache policy                                  |
| ------------- | ---------------------------------------- | --------------------------------------------- |
| bundle        | Vite `loadConfigFromFile`, bundle loader | Fresh process / Vite rebundling               |
| import        | Pure `await import(configUrl)`           | Fresh process only                            |
| oxnode        | `vite-plus/importer`                     | `moduleCache: false`                          |
| jiti          | jiti 2.7.0                               | `moduleCache: false`, `fsCache: false`        |
| jiti-fs-cache | jiti 2.7.0                               | `moduleCache: false`, primed filesystem cache |

The first three rows are the main comparison; jiti is an additional reference.
The bundle case imports the bundled Vite core directly, matching the CLI's loader
without paying for unrelated exports from the `vite-plus` public barrel.

The benchmark records parent-measured process wall time (including Node startup,
API import, loading, assertions and exit), API setup time, and the config-loading
call itself. Repeated loads in a single process have a separate measurement;
they discard the first load. Pure import is excluded from repeated-load comparisons
because dependency invalidation differs. Repeated-load timings do not themselves
prove that edits are observed.

These are **config-loading measurements, not dev-server ready times**. Vite's APIs
also perform config validation and return dependency metadata; direct importer
and jiti calls do less work. Compare both wall time and load-call time, and avoid
attributing their entire difference to the transformer.

The minimal fixture exports an object and a callable plugin. The graph fixture
imports `defineConfig` from Vite+ and 100 local TypeScript modules. The compatibility
fixture combines a dependency containing an enum with `__dirname` in an ESM config.
Every successful load checks the expected value and calls the plugin function.
Pure import is expected to reject the enum; any other failure aborts the
benchmark instead of producing a misleading timing.

Modes run sequentially in rotating order. An untimed compatibility pass primes OS
caches and jiti's filesystem cache; these are fresh-process samples, **not cold-disk
samples**. Node compile caching and inherited `NODE_OPTIONS` are disabled. Built-ins
and published JavaScript packages may still use Node's cache within a process.
Generated fixtures and the dedicated jiti cache stay inside ignored directories.

`results/latest.json` contains all raw samples, medians, p95, runtime/hardware
metadata, dependency versions, and the staged Vite+ commit. Results vary by machine.

## Recorded result

Measured on 2026-11-14 with Node 24.22.3, Apple M5 Pro, macOS arm64;
20 samples per supported case, Vite 8.3.8, Rolldown 1.2.19, jiti 2.7.0.
The POC commit is [`ccba9699a`](https://github.com/liangmiQwQ/vite-plus/commit/ccba9699a042d6b4e53b828cbcb2862dd2b1049a).

Median fresh-process wall time in milliseconds (lower is better):

| Fixture | Vite + Rolldown | Plain import | Oxnode importer | jiti, no disk cache | jiti, primed disk cache |
| --- | ---: | ---: | ---: | ---: | ---: |
| minimal | 98.1 | 50.6 | 38.2 | 107.5 | 41.3 |
| graph | 142.2 | 158.8 | 146.2 | 299.4 | 147.9 |
| compat | 98.9 | Unsupported enum | 39.4 | 113.8 | 43.0 |

Oxnode reduces minimal-config startup by about 61% versus bundling in this run,
but the 100-module graph is about 3% slower. Its results are close to jiti with a
primed filesystem cache. Plain import fails on the enum compatibility fixture.
This supports exploring the importer, but does not establish a universal startup
improvement or justify changing Vite's default loader.

The graph also imports Vite+'s `defineConfig`, so comparing it with `minimal`
changes both graph size and package-import work. These are representative
scenarios, not a controlled estimate of per-module transform cost.

See [raw samples and load/reload/p95 statistics](results/latest.json).

## Validation

The harness performs compatibility assertions before timings and validates every
successful load, including calling the returned plugin function. Unexpected
failures abort the run. The 20-sample run completed successfully.

The POC's public-API regression test verifies enum dependencies, ESM `__dirname`,
decorator runtime helpers, callable plugins, dependency edits with caching disabled,
and unchanged Node imports/require hooks. That test, `vp check`, `just check`, and
`just lint` passed. The full JS suite had 3,471 passing tests and one unrelated core
build-artifact snapshot failure. `just test` stopped at the existing
`vp_shared::http::tests::clients_send_a_user_agent` assertion. Those failures were
left unchanged; the POC is not presented as a completely green full-suite build.
