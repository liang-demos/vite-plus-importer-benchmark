import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const checkout = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !existsSync(join(checkout, 'packages/cli/dist/importer.js'))) {
  throw new Error('Usage: node setup.mjs /absolute/path/to/built/vite-plus-poc');
}
const cli = resolve('node_modules/vite-plus');
const core = resolve('node_modules/@voidzero-dev/vite-plus-core');
// Real package directories matter: oxnode deliberately transforms symlinked local source.
for (const [name, target] of [
  ['cli', cli],
  ['core', core],
]) {
  const source = join(checkout, 'packages', name);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });
  cpSync(join(source, 'package.json'), join(target, 'package.json'));
  cpSync(join(source, 'dist'), join(target, 'dist'), { recursive: true });
  const sourceModules = join(source, 'node_modules');
  const packages = readdirSync(sourceModules)
    .filter((name) => !name.startsWith('.'))
    .flatMap((name) =>
      name.startsWith('@')
        ? readdirSync(join(sourceModules, name)).map((child) => `${name}/${child}`)
        : [name],
    );
  for (const dependency of packages) {
    const link = join(target, 'node_modules', dependency);
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(
      dependency === 'vite' ? core : realpathSync(join(sourceModules, dependency)),
      link,
      'junction',
    );
  }
}
mkdirSync(join(cli, 'binding'), { recursive: true });
for (const name of readdirSync(join(checkout, 'packages/cli/binding'))) {
  if (name.startsWith('index.') || name.endsWith('.node')) {
    // Native binaries need no copy; JS wrappers remain under the staged package.
    const source = join(checkout, 'packages/cli/binding', name);
    if (name.endsWith('.node')) symlinkSync(source, join(cli, 'binding', name), 'file');
    else cpSync(source, join(cli, 'binding', name));
  }
}
const git = (...args) =>
  execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8' }).trim();
writeFileSync(
  '.benchmark-build.json',
  JSON.stringify(
    {
      vitePlusCommit: git('rev-parse', 'HEAD'),
      vitePlusDirty: Boolean(git('status', '--porcelain')),
      bundledVersions: JSON.parse(readFileSync(join(core, 'package.json'), 'utf8')).bundledVersions,
    },
    null,
    2,
  ),
);
console.log(
  'Staged built Vite+ packages under node_modules; dependency links reuse the checkout installation.',
);
