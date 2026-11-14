# Vite+ importer benchmark

Experiment for [vite-plus#3380](https://github.com/voidzero-dev/vite-plus/issues/3380).
Uses the existing oxnode module runner exposed as `vite-plus/importer` by the
[POC branch](https://github.com/liangmiQwQ/vite-plus/tree/liang/codex/3380-oxc-native-config-poc).

## Results: average time over 100 runs

Read **across each row** to compare the approaches on the same configuration.
Every timed cell is the **arithmetic mean of 100 independent process runs**,
in **milliseconds (ms); lower is faster**. All samples are included, with no
outlier removal. These replace the earlier 20-run median results.

| Configuration                 | Current: Vite + Rolldown | Pure `await import` | Oxnode importer | jiti, disk cache off | jiti, disk cache primed |
| ----------------------------- | -----------------------: | ------------------: | --------------: | -------------------: | ----------------------: |
| Simple config                 |                 103.9 ms |             53.1 ms |         40.6 ms |             111.7 ms |                 43.7 ms |
| 100 modules + `defineConfig`  |                 114.6 ms |            133.0 ms |        118.2 ms |             278.2 ms |                121.3 ms |
| Enum dependency + `__dirname` |                 103.1 ms |    Unsupported enum |         41.5 ms |             118.5 ms |                 44.1 ms |

**What the time means:** starting a new Node process, importing the loader,
loading the config, validating the returned config/plugin, and exiting. It is
not just transform time and not the time until a Vite dev server is ready.
The first three approach columns are the main comparison; jiti is a reference.

- **Simple config:** an object export with one callable plugin.
- **100 modules + `defineConfig`:** imports Vite+'s `defineConfig` and 100 local TypeScript files.
- **Enum dependency + `__dirname`:** checks syntax/compatibility that plain import does not support. A failure is not counted as a fast result.
- **jiti cache primed:** its filesystem transform cache was populated before timing; the other jiti column disables that cache.

The earlier setup accidentally loaded two Vite copies through `defineConfig` and
Vitest's peer dependency. This table supersedes those results: setup now stages
Vitest as well and asserts that both consumers resolve the same Vite core.
The old measurements remain in [commit 7777a4d](https://github.com/liang-demos/vite-plus-importer-benchmark/tree/7777a4d).

For the 100-module case, total process time is 114.6 ms for bundling and 118.2 ms
for oxnode, but initialization plus config loading takes about 80 ms for both.
The small total-time gap is outside the worker's timer, not evidence of slower
TypeScript transformation. See the [bottleneck analysis](ANALYSIS.md) for the phase
breakdown, JavaScript controls, parser prewarming, and importer instrumentation.

Measured on 2026-11-14 with Node 24.22.3, Apple M5 Pro, macOS arm64,
Vite 8.3.8, Rolldown 1.2.19, and jiti 2.7.0. The POC commit is
[`ccba9699a`](https://github.com/liangmiQwQ/vite-plus/commit/ccba9699a042d6b4e53b828cbcb2862dd2b1049a).

[Raw samples and statistics](results/latest.json) also contain the mean of the
loading call alone, mean repeated-load time (100 repetitions in one process),
medians, and p95. Those separate metrics are deliberately not mixed into the
startup table above. Results vary by machine.

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

Setup stages built CLI/core and Vitest JavaScript in real `node_modules` directories and links
their dependencies to the checkout installation. It avoids treating a symlinked
Vite+ checkout as local TypeScript source, which would distort importer timings.
Re-run setup after rebuilding the POC. The importer has no registry release yet.
`vp node bench.mjs --samples=100 --warm=100` explicitly selects the new defaults: 100 fresh-process samples and 100 repeated loads per supported case.
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

`results/latest.json` contains all raw samples, arithmetic means, medians, p95, runtime/hardware
metadata, dependency versions, and the staged Vite+ commit. Results vary by machine.

## Validation

The harness performs compatibility assertions before timings and validates every
successful load, including calling the returned plugin function. Unexpected
failures abort the run. The 100-sample run completed successfully (1,400 timed fresh-process runs across the 14 supported combinations).

The POC's public-API regression test verifies enum dependencies, ESM `__dirname`,
decorator runtime helpers, callable plugins, dependency edits with caching disabled,
and unchanged Node imports/require hooks. That test, `vp check`, `just check`, and
`just lint` passed. The full JS suite had 3,471 passing tests and one unrelated core
build-artifact snapshot failure. `just test` stopped at the existing
`vp_shared::http::tests::clients_send_a_user_agent` assertion. Those failures were
left unchanged; the POC is not presented as a completely green full-suite build.
