/** Copies out/ into apps/web/public/tiles for local dev (gitignored there, never committed). */
import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { OUT_DIR, PKG_DIR } from './lib.js';

const target = path.resolve(PKG_DIR, '../../apps/web/public/tiles');

if (!existsSync(path.join(OUT_DIR, 'manifest.json'))) {
  console.error('✗ out/manifest.json not found — run `pnpm --filter map-tiles run build` first');
  process.exit(1);
}
const started = Date.now();
rmSync(target, { recursive: true, force: true });
cpSync(OUT_DIR, target, { recursive: true });
console.log(`✓ copied ${OUT_DIR} → ${target} in ${((Date.now() - started) / 1000).toFixed(1)} s`);
