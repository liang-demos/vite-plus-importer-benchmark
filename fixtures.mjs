import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function generateFixtures(root) {
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, 'minimal.ts'),
    'export default { marker: 42, plugins: [{ name: "bench", config: () => ({ define: { BENCH: "42" } }) }] }\n',
  );
  // A wide graph stresses resolution and per-module transforms without application work.
  const graph = join(root, 'graph');
  mkdirSync(graph, { recursive: true });
  for (let i = 0; i < 100; i++) {
    writeFileSync(join(graph, `${i}.ts`), `export const value: number = ${i}\n`);
  }
  writeFileSync(
    join(root, 'graph.ts'),
    [
      "import { defineConfig } from 'vite-plus'",
      ...Array.from({ length: 100 }, (_, i) => `import { value as v${i} } from './graph/${i}.ts'`),
      `export default defineConfig({ marker: ${Array.from({ length: 100 }, (_, i) => `v${i}`).join(' + ')}, plugins: [{ name: 'bench', config: () => ({}) }] })`,
    ].join('\n'),
  );
  writeFileSync(join(root, 'enum-dep.ts'), 'export enum Value { Current = 42 }\n');
  writeFileSync(
    join(root, 'compat.ts'),
    `import { Value } from './enum-dep.ts'
export default { marker: Value.Current, directory: __dirname, plugins: [{ name: 'bench', config: () => ({}) }] }
`,
  );
}
