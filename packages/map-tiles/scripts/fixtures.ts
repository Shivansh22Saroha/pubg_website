/**
 * Writes the tiny committed fixture tile set used by unit/E2E tests and CI (TESTING §8):
 * zoom 0–2, solid colours (labels and clean differ so a swap is visible), plus a low-res
 * placeholder per map. Real tiles are never needed in CI.
 */
import { mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { MAPS, PKG_DIR, VARIANTS, type MapKey, type Variant } from './lib.js';

const TARGET = path.resolve(PKG_DIR, '../../apps/web/e2e/fixtures/tiles');
const MAX_ZOOM = 2;

const COLORS: Record<MapKey, Record<Variant, string>> = {
  erangel: { labels: '#4d7c3a', clean: '#2f5f8a' },
  miramar: { labels: '#b38b4d', clean: '#7a5a2e' },
  rondo: { labels: '#6b7f8c', clean: '#3f4f5a' },
};

function solid(hex: string, size: number) {
  return sharp({ create: { width: size, height: size, channels: 3, background: hex } });
}

rmSync(TARGET, { recursive: true, force: true });
let count = 0;
for (const map of MAPS) {
  for (const variant of VARIANTS) {
    for (let z = 0; z <= MAX_ZOOM; z++) {
      const n = 2 ** z;
      for (let y = 0; y < n; y++) {
        const dir = path.join(TARGET, map, variant, String(z), String(y));
        mkdirSync(dir, { recursive: true });
        for (let x = 0; x < n; x++) {
          await solid(COLORS[map][variant], 256)
            .webp({ quality: 50 })
            .toFile(path.join(dir, `${x}.webp`));
          count++;
        }
      }
    }
  }
  await solid('#20262e', 64)
    .jpeg({ quality: 60 })
    .toFile(path.join(TARGET, map, 'lowres.jpg'));
}
console.log(`✓ wrote ${count} fixture tiles + ${MAPS.length} placeholders to ${TARGET}`);
