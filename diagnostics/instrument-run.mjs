import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
// Instrumented timings identify costs; keep them separate from baseline timings.
const cases = [
  ['minimal.ts', 'none'],
  ['bare100.ts', 'none'],
  ['define100.ts', 'none'],
  ['define100.ts', 'package'],
].map(([file, warm]) => ({ file, warm, samples: [] }));
const env = { ...process.env, NODE_DISABLE_COMPILE_CACHE: '1' };
delete env.NODE_OPTIONS;
delete env.NODE_COMPILE_CACHE;
for (let i = 0; i < 30; i++)
  for (let j = 0; j < cases.length; j++) {
    const row = cases[(i + j) % cases.length];
    const r = spawnSync(
      process.execPath,
      ['diagnostics/instrument.mjs', resolve('.fixtures/diagnostics', row.file), row.warm],
      { encoding: 'utf8', env, timeout: 60000 },
    );
    if (r.status !== 0) throw new Error(r.stderr);
    row.samples.push(JSON.parse(r.stdout));
  }
const summary = cases.map((row) => ({
  file: row.file,
  warm: row.warm,
  loadMs: row.samples.reduce((s, x) => s + x.loadMs, 0) / 30,
  metrics: Object.fromEntries(
    Object.keys(row.samples[0].metrics).map((key) => [
      key,
      {
        calls: row.samples[0].metrics[key].calls,
        ms: row.samples.reduce((s, x) => s + x.metrics[key].ms, 0) / 30,
      },
    ]),
  ),
}));
writeFileSync(
  'results/instrumentation.json',
  JSON.stringify(
    {
      node: process.version,
      build: JSON.parse(readFileSync('.benchmark-build.json', 'utf8')),
      samples: 30,
      summary,
      cases,
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify(summary, null, 2));
