import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
// Vary TypeScript and package imports independently of module count.
const root = resolve('.fixtures/diagnostics');
mkdirSync(root, { recursive: true });
const fixtures = [];
for (const ext of ['ts', 'mjs']) {
  for (let i = 0; i < 100; i++)
    writeFileSync(
      join(root, `dep-${i}.${ext}`),
      `export const value${ext === 'ts' ? ': number' : ''} = ${i};\n`,
    );
  for (const [name, count, usePackage] of [
    ['minimal', 0, false],
    ['define', 0, true],
    ['bare100', 100, false],
    ['define100', 100, true],
  ]) {
    const imports = Array.from(
      { length: count },
      (_, i) => `import { value as v${i} } from './dep-${i}.${ext}';`,
    ).join('\n');
    const value = count ? Array.from({ length: count }, (_, i) => `v${i}`).join('+') : '42';
    const object = `{ marker: ${value} }`;
    const file = join(root, `${name}.${ext}`);
    writeFileSync(
      file,
      `${usePackage ? "import { defineConfig } from 'vite-plus';" : ''}\n${imports}\nexport default ${usePackage ? `defineConfig(${object})` : object};\n`,
    );
    fixtures.push(file);
  }
}
const cases = fixtures.flatMap((file) =>
  ['bundle', 'import', 'oxnode'].map((mode) => ({ file, mode, warm: 'none', samples: [] })),
);
for (const name of ['minimal.ts', 'define100.ts'])
  cases.push({ file: join(root, name), mode: 'import', warm: 'types', samples: [] });
for (const mode of ['bundle', 'import', 'oxnode'])
  cases.push({ file: join(root, 'define100.ts'), mode, warm: 'package', samples: [] });
const env = { ...process.env, NODE_DISABLE_COMPILE_CACHE: '1' };
delete env.NODE_OPTIONS;
delete env.NODE_COMPILE_CACHE;
// Rotate independent child processes to reduce ordering bias.
for (let round = 0; round < 30; round++) {
  for (let offset = 0; offset < cases.length; offset++) {
    const item = cases[(round + offset) % cases.length];
    const start = performance.now();
    const result = spawnSync(
      process.execPath,
      ['diagnostics/worker.mjs', item.mode, item.file, item.warm],
      { encoding: 'utf8', env, timeout: 60000 },
    );
    const wallMs = performance.now() - start;
    if (result.status !== 0) throw new Error(result.stderr);
    item.samples.push({ ...JSON.parse(result.stdout), wallMs });
  }
  if ((round + 1) % 10 === 0) console.log(`Completed ${round + 1}/30 rounds`);
}
const summary = cases.map((item) => ({
  fixture: item.file.split('/').at(-1),
  mode: item.mode,
  warm: item.warm,
  ...Object.fromEntries(
    ['setupMs', 'warmMs', 'loadMs', 'wallMs'].map((key) => [
      key,
      item.samples.reduce((s, x) => s + x[key], 0) / item.samples.length,
    ]),
  ),
}));
writeFileSync(
  'results/diagnostics.json',
  JSON.stringify(
    {
      node: process.version,
      build: JSON.parse(readFileSync('.benchmark-build.json', 'utf8')),
      samples: 30,
      summary,
      cases: cases.map((item) => ({ ...item, file: item.file.split('/').at(-1) })),
    },
    null,
    2,
  ) + '\n',
);
console.table(summary);
