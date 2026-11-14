# Config loading bottlenecks

Measured on Node 24.22.3 / Apple M5 Pro, 2026-11-14. Primary results use 100
fresh-process samples per supported case; controlled diagnostics use 30 per case.
Compilation caches remain disabled. These findings concern this runtime and these
fixtures, not every Node version, project, or cache policy.

## First correct the setup

The previous staging copied Vite+ and core, but linked Vitest from the checkout.
Vite+'s `defineConfig` resolved the staged core while Vitest's `vite` peer resolved
the checkout core. Different real paths caused Node to compile/evaluate two Vite
copies. CPU profiles showed frames from both paths. Setup now stages Vitest too,
redirects its peer, and asserts that both resolutions are identical. A follow-up
profile had no frames from the original checkout core.

The graph's original 147.7 ms (bundle) / 150.9 ms (oxnode) wall times therefore
included an artificial dependency cost. The corrected 100-sample run gives
114.6 ms / 118.2 ms. Previous raw data are preserved in git history.

## Why the graph appears slightly slower

Corrected primary graph measurements, arithmetic mean in milliseconds:

| Phase                    | Vite + Rolldown | Pure import | Oxnode importer |
| ------------------------ | --------------: | ----------: | --------------: |
| Loader initialization    |            60.4 |         0.0 |             8.1 |
| Config load call         |            20.2 |        94.6 |            72.2 |
| Initialization + load    |            80.7 |        94.6 |            80.3 |
| Outside the worker timer |            33.9 |        38.3 |            37.8 |
| Full process wall time   |           114.6 |       133.0 |           118.2 |

The row sums differ slightly because of rounding and config assertions. Outside
worker time is `wallMs - totalMs`: process creation, Node/static-import startup,
stdio/exit, and scheduling. It has not been isolated further, so it should not be
attributed specifically to shutdown, GC, or the transformer.

Bundling initializes Vite before timing its load call. Oxnode initializes only its
importer, then pays for Vite when the config imports `defineConfig`. Comparing
20.2 ms with 72.2 ms alone moves shared work between phases and is misleading.
Combined initialization/loading is essentially tied. The small wall-time gap
is outside that measurement, as it was in the original data.

## Most graph loading time is package initialization

Controlled oxnode cases, 30 samples each:

| Config                                             | Load-call mean |
| -------------------------------------------------- | -------------: |
| Minimal TypeScript                                 |        1.06 ms |
| 100 local TS modules, no `defineConfig`            |       12.79 ms |
| `defineConfig`, no local dependencies              |       60.05 ms |
| `defineConfig` + 100 local TS modules              |       71.37 ms |
| Same graph, after explicitly importing `vite-plus` |       12.61 ms |

The explicit package prewarm costs 59.03 ms itself; it moves work rather than
making total startup free. This attributes most of the graph load to initializing
the package graph. The public entry re-exports Vite and Vitest configuration APIs;
`define-config.ts` also imports them at runtime. A CPU profile's largest self-time
bucket was Node's `compileSourceTextModule`, consistent with compiling that JS
dependency graph rather than spending most CPU time transforming our tiny TS files.
Profiler timings include instrumentation overhead and are not benchmark timings.

The 100-module-only fixture takes about 52.0 ms full-process time through oxnode,
versus 105.0 ms through bundling. The name "100 modules" in the original table
hid the additional package-import variable; it was not an isolated scaling test.

## Where the importer's own time goes

Separate instrumented processes wrap the native resolver/transformer, local file
reads, and `vm.runInThisContext`. Thirty runs of the graph with its package already
warm average 12.89 ms for the load call:

| Work                                                     | Calls | Mean cumulative time |
| -------------------------------------------------------- | ----: | -------------------: |
| Resolve module paths                                     |   102 |              3.68 ms |
| Oxc module-runner transform                              |   101 |              2.30 ms |
| Read local source files                                  |   101 |              1.68 ms |
| Compile evaluation wrappers in VM                        |   101 |              1.45 ms |
| Remaining graph/evaluation work and measurement overhead |     — |        about 3.78 ms |

The transform includes TS lowering and module-runner rewriting. The remainder is
not separately attributed; it includes source-map handling, module records,
namespace/interop work, async execution, and diagnostic wrappers. It is not all
JavaScript execution time. These are instrumented figures, so use them for cost
attribution, not to rank loaders against uninstrumented runs.

Oxnode resolves, reads, transforms, and evaluates individual modules. Rolldown
combines local modules before evaluation, reducing per-module runtime machinery.
That is a plausible scaling advantage for bundling, but these results do not show
that Oxc transformation itself is the bottleneck.

## Why oxnode beats plain import for TypeScript

The key is the extension and cold TypeScript support, not that native ESM is
inherently slow. Node's built-in `internal/modules/typescript` lazily requires
`internal/deps/amaro/dist/index`. In this runtime, that module decodes bundled
WASM and constructs `WebAssembly.Module` / `WebAssembly.Instance`. CPU sampling
of a minimal `.ts` import showed Amaro loading and WASM work as dominant costs.
Even a `.ts` file containing only valid JavaScript triggers this path.

Controlled minimal-file comparison (30 samples):

| Case                                      | Loader setup | Load call | Full process |
| ----------------------------------------- | -----------: | --------: | -----------: |
| Native import of `.ts`                    |        ~0 ms |  20.44 ms |     51.73 ms |
| Native import of equivalent `.mjs`        |        ~0 ms |   0.25 ms |     30.69 ms |
| Oxnode import of `.ts`                    |      7.93 ms |   1.06 ms |     40.06 ms |
| Oxnode import of equivalent `.mjs`        |      7.91 ms |   1.03 ms |     40.06 ms |
| Native `.ts`, after warming the TS parser |        ~0 ms |   1.39 ms |     54.26 ms |

The parser prewarm itself takes 20.57 ms, included in the final column. The load
call gets faster but total startup does not: the first-use cost merely moved.
Oxnode pays roughly 8 ms to initialize the native addon/importer and avoids this
Node TS-parser path for its local files. It uses its own module runner rather than
registering a hook around Node's native `import()`.

With `.mjs`, plain import wins. For 100 local files without the package import,
plain `.mjs` import takes 7.37 ms inside the load call versus oxnode's 12.71 ms.
This is a cold TypeScript-loading advantage, not a universal advantage over ESM.
Warm parsers, disk compilation caches, and other Node releases can change it.

## Optimization priorities

1. Keep a single Vite instance: the fixed staging demonstrates how costly duplicate
   dependency initialization can be.
2. Investigate a lighter config-only entry or lazy initialization of unrelated
   Vite/Vitest exports, while preserving `defineConfig` behavior. Package loading
   is the main cold-graph cost here; this is a proposed follow-up, not implemented.
3. For reloads/larger graphs, evaluate resolver/module/transform caching and
   invalidation. Per-file resolution is larger than transformation in this fixture.
4. Measure time until config availability separately from process exit before
   claiming a few milliseconds of startup regression.

## Reproduce and inspect

After the README setup instructions:

```sh
vp node diagnostics/run.mjs
vp node diagnostics/instrument-run.mjs
NODE_DISABLE_COMPILE_CACHE=1 vp node --cpu-prof --cpu-prof-dir=.results-tmp \
  diagnostics/worker.mjs import "$PWD/.fixtures/diagnostics/minimal.ts"
NODE_DISABLE_COMPILE_CACHE=1 vp node --cpu-prof --cpu-prof-dir=.results-tmp \
  diagnostics/worker.mjs oxnode "$PWD/.fixtures/diagnostics/define100.ts"
```

[Primary samples](results/latest.json), [controlled experiments](results/diagnostics.json),
and [instrumented samples](results/instrumentation.json) retain the measurements.
The controls independently vary `.ts`/`.mjs`, module count, package imports, and
prewarming; every successful load checks the config value. Instrumentation lives
only in diagnostic child processes and never modifies the shipped importer.
