#!/usr/bin/env node
// Fails when code imports a package its workspace doesn't declare (the Phase 6 fresh-clone bug:
// the server imported five packages that only resolved from a stale local node_modules).
//
// Rules, per workspace package (apps/*, packages/*):
// - runtime code (src/**) may import only that package's own dependencies / devDependencies;
// - tooling (test/, e2e/, scripts/, *.config.*) may also use the root devDependencies;
// - Node built-ins, relative paths and the `@/` alias are always fine.
// Ignores the file arguments lint-staged passes: the whole repo takes well under a second.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const depsOf = (pkg) =>
  new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ]);
const rootPkg = readJson(path.join(root, 'package.json'));
const rootDeps = depsOf(rootPkg);
const builtins = new Set(builtinModules);

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  '.next-e2e',
  '.turbo',
  'out',
  'coverage',
  'playwright-report',
  'test-results',
  '.cache',
  'fixtures',
]);
const CODE = /\.(?:[cm]?[jt]sx?)$/;
// static imports/exports (incl. `import type`), dynamic import(), require()
const IMPORT =
  /(?:^|[\s;])(?:import|export)\s[^'"`]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;(=])import\s*['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)|\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;

function* files(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (CODE.test(name) && !name.endsWith('.d.ts')) yield p;
  }
}

/** 'lodash/fp' → 'lodash', '@scope/pkg/x' → '@scope/pkg'; null for things that aren't packages */
function packageName(spec) {
  if (
    spec.startsWith('.') ||
    spec.startsWith('/') ||
    spec.startsWith('@/') ||
    spec.startsWith('node:')
  )
    return null;
  const parts = spec.split('/');
  const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  if (!name || builtins.has(name)) return null;
  return name;
}

const workspaces = ['apps', 'packages'].flatMap((group) =>
  readdirSync(path.join(root, group))
    .map((n) => path.join(root, group, n))
    .filter((d) => {
      try {
        return statSync(path.join(d, 'package.json')).isFile();
      } catch {
        return false;
      }
    }),
);

const problems = [];
for (const dir of [...workspaces, root]) {
  const isRoot = dir === root;
  const own = isRoot ? rootDeps : depsOf(readJson(path.join(dir, 'package.json')));
  const pkgName = isRoot ? rootPkg.name : readJson(path.join(dir, 'package.json')).name;
  const scan = isRoot ? [path.join(root, 'scripts')] : [dir];
  for (const base of scan) {
    let list;
    try {
      list = [...files(base)];
    } catch {
      continue;
    }
    for (const file of list) {
      const rel = path.relative(dir, file).split(path.sep).join('/');
      if (!isRoot && (rel.startsWith('apps/') || rel.startsWith('packages/'))) continue;
      const tooling = isRoot || !rel.startsWith('src/');
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(IMPORT)) {
        const name = packageName(m[1] ?? m[2] ?? m[3] ?? m[4] ?? '');
        if (!name || name === pkgName) continue;
        if (own.has(name) || (tooling && rootDeps.has(name))) continue;
        problems.push(
          `${path.relative(root, file)}: imports "${name}" — not declared in ${isRoot ? 'the root' : path.relative(root, dir)} package.json`,
        );
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`✗ undeclared dependencies:\n  ${[...new Set(problems)].join('\n  ')}`);
  process.exit(1);
}
console.log(`✓ every import is declared (${workspaces.length} workspace packages)`);
