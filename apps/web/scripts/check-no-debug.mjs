// Fails if the dev/E2E debug hook leaked into a production build's browser or server code.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] ?? '.next');
// strings that only exist inside lib/debug/rlDebug.ts (a dead `installRlDebug` property name may remain)
const needles = ['addRandomElements', 'deleteAll()', 'moveElement('];
const hits = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.js') && needles.some((n) => readFileSync(p, 'utf8').includes(n)))
      hits.push(p);
  }
}
for (const sub of ['static', 'server']) {
  try {
    walk(path.join(root, sub));
  } catch {
    // not built
  }
}
if (hits.length > 0) {
  console.error(`✗ debug hook found in production build:\n${hits.join('\n')}`);
  process.exit(1);
}
console.log(`✓ no debug hook in ${root}`);
