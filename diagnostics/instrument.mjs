import fs from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const binding = require(
  join(dirname(require.resolve('vite-plus/package.json')), 'binding/index.cjs'),
).oxcNode;
// These wrappers affect only this diagnostic subprocess, never the shipped importer.
const metrics = {};
function wrap(object, key, filter = () => true) {
  const original = object[key];
  metrics[key] = { calls: 0, ms: 0 };
  object[key] = function (...args) {
    if (!filter(...args)) return Reflect.apply(original, this, args);
    const start = performance.now();
    try {
      return Reflect.apply(original, this, args);
    } finally {
      metrics[key].calls++;
      metrics[key].ms += performance.now() - start;
    }
  };
}
wrap(binding, 'transformModuleRunner');
wrap(binding, 'createResolve');
wrap(fs, 'readFileSync', (file) => String(file).includes('/.fixtures/diagnostics/'));
wrap(vm, 'runInThisContext');
syncBuiltinESMExports();
const { createImporter } = await import('vite-plus/importer');
const importer = createImporter(import.meta.url, { moduleCache: false });
if (process.argv[3] === 'package') await import('vite-plus');
for (const value of Object.values(metrics)) {
  value.calls = 0;
  value.ms = 0;
}
const start = performance.now();
const config = await importer.import(process.argv[2], { default: true });
const loadMs = performance.now() - start;
if (![42, 4950].includes(config.marker)) throw new Error('Invalid config');
process.stdout.write(JSON.stringify({ loadMs, metrics }));
