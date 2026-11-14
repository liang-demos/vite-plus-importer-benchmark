import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { cpus, platform, release, arch } from 'node:os';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

import { generateFixtures } from './fixtures.mjs';

const require = createRequire(import.meta.url);
const option = (name, fallback) =>
  Number(process.argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
const samples = option('samples', 20);
const warm = option('warm', 20);
if (![samples, warm].every((n) => Number.isInteger(n) && n > 0))
  throw new Error('samples and warm must be positive integers');
const modes = ['bundle', 'import', 'oxnode', 'jiti', 'jiti-fs-cache'];
const fixtures = ['minimal', 'graph', 'compat'];
const root = resolve('.fixtures');
const cache = resolve('.results-tmp/jiti');
generateFixtures(root);
rmSync(cache, { recursive: true, force: true });
mkdirSync(cache, { recursive: true });
const env = { ...process.env, NODE_DISABLE_COMPILE_CACHE: '1', BENCH_JITI_CACHE: cache };
delete env.NODE_OPTIONS;
delete env.NODE_COMPILE_CACHE;
const results = [];

function run(mode, fixture, repetitions = 1) {
  const started = performance.now();
  const result = spawnSync(
    process.execPath,
    ['worker.mjs', mode, join(root, `${fixture}.ts`), String(repetitions)],
    { encoding: 'utf8', env, timeout: 60_000 },
  );
  const wallMs = performance.now() - started;
  if (result.error) throw result.error;
  if (result.status !== 0) return { error: result.stderr.trim(), status: result.status };
  return { ...JSON.parse(result.stdout), wallMs };
}

// Check behavior before timing; this also primes OS and jiti filesystem caches.
for (const fixture of fixtures) {
  for (const mode of modes) {
    const result = run(mode, fixture);
    const expectedFailure = fixture === 'compat' && mode === 'import';
    if (Boolean(result.error) !== expectedFailure)
      throw new Error(`${fixture}/${mode}: unexpected result ${JSON.stringify(result)}`);
    if (expectedFailure && !/ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX/.test(result.error))
      throw new Error(result.error);
    results.push({ fixture, mode, supported: !result.error, error: result.error, samples: [] });
  }
}

// Rotate mode order on each sequential round to reduce time/order bias.
for (let round = 0; round < samples; round++) {
  for (const fixture of fixtures) {
    for (let offset = 0; offset < modes.length; offset++) {
      const mode = modes[(round + offset) % modes.length];
      const row = results.find((row) => row.fixture === fixture && row.mode === mode);
      if (!row.supported) continue;
      const result = run(mode, fixture);
      if (result.error) throw new Error(result.error);
      row.samples.push(result);
    }
  }
}
for (const row of results) {
  if (!row.supported || row.mode === 'import') continue;
  // Native's dependency cache cannot be cleared here, so it is excluded from reload timing.
  const result = run(row.mode, row.fixture, warm + 1);
  if (result.error) throw new Error(result.error);
  row.warmLoads = result.loads.slice(1);
}
const percentile = (values, fraction) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1];
const summary = results.map((row) => ({
  fixture: row.fixture,
  mode: row.mode,
  supported: row.supported,
  wallMedianMs: row.supported
    ? percentile(
        row.samples.map((s) => s.wallMs),
        0.5,
      )
    : null,
  wallP95Ms: row.supported
    ? percentile(
        row.samples.map((s) => s.wallMs),
        0.95,
      )
    : null,
  loadMedianMs: row.supported
    ? percentile(
        row.samples.map((s) => s.loads[0]),
        0.5,
      )
    : null,
  reloadMedianMs: row.warmLoads ? percentile(row.warmLoads, 0.5) : null,
}));
const vpPackage = require.resolve('vite-plus/package.json');
const build = JSON.parse(readFileSync('.benchmark-build.json', 'utf8'));
const report = {
  metadata: {
    date: new Date().toISOString(),
    node: process.version,
    os: `${platform()} ${release()} ${arch()}`,
    cpu: cpus()[0].model,
    samples,
    warm,
    ...build,
    vitePlus: JSON.parse(readFileSync(vpPackage, 'utf8')).version,
    jiti: JSON.parse(readFileSync(require.resolve('jiti/package.json'), 'utf8')).version,
  },
  summary,
  results,
};
mkdirSync('results', { recursive: true });
writeFileSync('results/latest.json', `${JSON.stringify(report, null, 2)}\n`);
console.table(summary);
