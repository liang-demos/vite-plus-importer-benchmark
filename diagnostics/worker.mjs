import assert from 'node:assert/strict';
import { stripTypeScriptTypes } from 'node:module';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
const [mode, file, warm = 'none'] = process.argv.slice(2);
const started = performance.now();
let load;
if (mode === 'bundle') {
  const { loadConfigFromFile } = await import('@voidzero-dev/vite-plus-core');
  load = async () =>
    (
      await loadConfigFromFile(
        { command: 'serve', mode: 'development' },
        file,
        dirname(file),
        'silent',
        undefined,
        'bundle',
      )
    ).config;
} else if (mode === 'oxnode') {
  const { createImporter } = await import('vite-plus/importer');
  const importer = createImporter(import.meta.url, { moduleCache: false });
  load = () => importer.import(file, { default: true });
} else load = async () => (await import(pathToFileURL(file).href)).default;
const setupMs = performance.now() - started;
// Account for prewarming separately; it moves startup work rather than eliminating it.
const beforeWarm = performance.now();
if (warm === 'types') stripTypeScriptTypes('const value: number = 1');
if (warm === 'package') await import('vite-plus');
const warmMs = performance.now() - beforeWarm;
const beforeLoad = performance.now();
const result = await load();
const loadMs = performance.now() - beforeLoad;
assert.equal(result.marker, file.includes('100') ? 4950 : 42);
process.stdout.write(JSON.stringify({ setupMs, warmMs, loadMs }));
