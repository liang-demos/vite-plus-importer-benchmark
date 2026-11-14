import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

const [mode, file, repetitionsText = '1'] = process.argv.slice(2);
const started = performance.now();
let load;
// Each mode pays for its own API initialization; the parent also measures process startup.
if (mode === 'oxnode') {
  const { createImporter } = await import('vite-plus/importer');
  const importer = createImporter(import.meta.url, { moduleCache: false });
  load = () => importer.import(file, { default: true });
} else if (mode === 'import') {
  load = async () => (await import(pathToFileURL(file).href)).default;
} else if (mode === 'jiti' || mode === 'jiti-fs-cache') {
  const { createJiti } = await import('jiti');
  const jiti = createJiti(import.meta.url, {
    moduleCache: false,
    fsCache: mode === 'jiti-fs-cache' ? process.env.BENCH_JITI_CACHE : false,
  });
  load = () => jiti.import(file, { default: true });
} else {
  const { loadConfigFromFile } = await import('@voidzero-dev/vite-plus-core');
  load = async () => {
    const result = await loadConfigFromFile(
      { command: 'serve', mode: 'development' },
      file,
      dirname(file),
      'silent',
      undefined,
      mode,
    );
    assert.ok(result, 'Config must be found');
    return result.config;
  };
}
const setupMs = performance.now() - started;
const loads = [];
for (let i = 0; i < Number(repetitionsText); i++) {
  const start = performance.now();
  const config = await load();
  loads.push(performance.now() - start);
  assert.equal(config.marker, file.endsWith('/graph.ts') ? 4950 : 42);
  const plugin = config.plugins.flat(Infinity).find((plugin) => plugin?.name === 'bench');
  assert.ok(plugin, 'Expected benchmark plugin');
  assert.equal(typeof plugin.config, 'function');
  assert.equal(typeof plugin.config(), 'object');
  if (file.endsWith('/compat.ts')) assert.equal(config.directory, dirname(file));
}
process.stdout.write(JSON.stringify({ setupMs, loads, totalMs: performance.now() - started }));
