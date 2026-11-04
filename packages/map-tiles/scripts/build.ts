/**
 * Slices the downloaded map art into WebP XYZ tiles (ARCHITECTURE §6 step 2).
 *
 *   pnpm --filter map-tiles build            # all maps
 *   pnpm --filter map-tiles build rondo      # one map (merged into the existing manifest)
 *
 * Output: out/<map>/<labels|clean>/{z}/{y}/{x}.webp, out/<map>/{preview,thumb,lowres}.jpg,
 * out/icons/items/<id>.webp (Phase 12 loot icons), out/manifest.json. One image is processed
 * at a time to keep RAM bounded.
 */
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  ICONS_DIR,
  ICON_SIZE,
  MAPS,
  OUT_DIR,
  REPO_DIR,
  SOURCES_FILE,
  VARIANTS,
  formatBytes,
  type MapKey,
  type SourceEntry,
  type SourceKind,
  type SourcesFile,
  type Variant,
} from './lib.js';

const TILE_SIZE = 256;
const TILE_QUALITY = Number(process.env.TILE_QUALITY ?? 82);
const PREVIEW_SIZE = 1024;
const THUMB_SIZE = 256;
/** dashboard room cards (shown ≤ ~380 px) — keeps their LCP image ~25 KB instead of the 150 KB preview */
const CARD_SIZE = 512;

export interface VariantManifest {
  sourceSize: number;
  paddedSize: number;
  maxNativeZoom: number;
  sha256: string;
  tileCount: number;
  bytes: number;
}

export interface MapManifest {
  map: MapKey;
  sourceSize: number;
  paddedSize: number;
  maxNativeZoom: number;
  variants: Record<Variant, VariantManifest>;
  preview: string;
  card: string;
  thumbnail: string;
  lowres: { file: string; sourceFormat: string; sourceSize: number; sha256: string };
}

export interface Manifest {
  version: 1;
  tileSize: number;
  format: 'webp';
  layout: 'google';
  source: { repo: string; commit: string };
  generatedAt: string;
  maps: Partial<Record<MapKey, MapManifest>>;
  /** Phase 12: the loot item icons */
  icons?: { dir: string; count: number; bytes: number };
}

sharp.cache(false); // don't hold decoded 8k images between steps

/** Smallest 256·2^k that is ≥ side. */
export function paddedSizeFor(side: number): number {
  let size = TILE_SIZE;
  while (size < side) size *= 2;
  return size;
}

function source(sources: SourcesFile, map: MapKey, kind: SourceKind): SourceEntry {
  const entry = sources.files.find((f) => f.map === map && f.kind === kind);
  if (!entry) throw new Error(`${map}/${kind} missing from sources.json — run fetch again`);
  return entry;
}

/** Dimensions via sharp, with the pixel limit set to exactly what the header claims. */
async function measure(file: string): Promise<{ width: number; height: number; pixels: number }> {
  // header-only read under sharp's default pixel limit (never `false`)
  const header = await sharp(file).metadata();
  const { width, height } = header;
  if (!width || !height) throw new Error(`${file}: could not read dimensions`);
  const pixels = width * height;
  // re-open with a hard limit equal to the measured size — anything larger is rejected on decode
  await sharp(file, { limitInputPixels: pixels }).metadata();
  return { width, height, pixels };
}

function walk(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = walk(p);
      files += sub.files;
      bytes += sub.bytes;
    } else if (entry.name.endsWith('.webp')) {
      files += 1;
      bytes += statSync(p).size;
    }
  }
  return { files, bytes };
}

async function buildVariant(
  map: MapKey,
  variant: Variant,
  src: SourceEntry,
): Promise<VariantManifest> {
  const file = path.join(REPO_DIR, src.repoPath);
  const t0 = Date.now();
  const { width, height, pixels } = await measure(file);
  if (width !== height)
    throw new Error(`${src.repoPath}: expected a square image, got ${width}×${height}`);

  const paddedSize = paddedSizeFor(width);
  const maxNativeZoom = Math.log2(paddedSize / TILE_SIZE);
  const outDir = path.join(OUT_DIR, map, variant);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(path.dirname(outDir), { recursive: true });

  let pipeline = sharp(file, { limitInputPixels: pixels });
  if (paddedSize !== width) {
    // pad right/bottom only, so world (0,0) stays at pixel (0,0); scale is recorded in the manifest
    pipeline = pipeline.extend({
      right: paddedSize - width,
      bottom: paddedSize - height,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
  }
  await pipeline
    .webp({ quality: TILE_QUALITY, effort: 4 })
    .tile({ size: TILE_SIZE, overlap: 0, layout: 'google', skipBlanks: -1 })
    .toFile(outDir);

  // libvips may drop helper files next to the pyramid; only {z}/{y}/{x}.webp is served
  for (const dir of [outDir, path.dirname(outDir)]) {
    for (const extra of ['blank.png', 'vips-properties.xml'])
      rmSync(path.join(dir, extra), { force: true });
  }

  const { files, bytes } = walk(outDir);
  const expected = Array.from({ length: maxNativeZoom + 1 }, (_, z) => 4 ** z).reduce(
    (a, b) => a + b,
    0,
  );
  if (files !== expected)
    throw new Error(`${map}/${variant}: expected ${expected} tiles, found ${files}`);

  console.log(
    `  ${variant.padEnd(6)} ${width}×${height} px → padded ${paddedSize} (${paddedSize === width ? 'no padding' : `+${paddedSize - width} px`}), ` +
      `z0–${maxNativeZoom}, ${files} tiles, ${formatBytes(bytes)}, ${((Date.now() - t0) / 1000).toFixed(1)} s`,
  );
  return {
    sourceSize: width,
    paddedSize,
    maxNativeZoom,
    sha256: src.sha256,
    tileCount: files,
    bytes,
  };
}

async function buildMap(map: MapKey, sources: SourcesFile): Promise<MapManifest> {
  console.log(`▸ ${map}`);
  const variants = {} as Record<Variant, VariantManifest>;
  for (const variant of VARIANTS) {
    variants[variant] = await buildVariant(map, variant, source(sources, map, variant));
  }
  const { labels, clean } = variants;
  if (labels.sourceSize !== clean.sourceSize) {
    throw new Error(
      `${map}: labels (${labels.sourceSize}) and clean (${clean.sourceSize}) art differ in size`,
    );
  }

  const labelsFile = path.join(REPO_DIR, source(sources, map, 'labels').repoPath);
  const pixels = labels.sourceSize ** 2;
  const mapDir = path.join(OUT_DIR, map);
  await sharp(labelsFile, { limitInputPixels: pixels })
    .resize(PREVIEW_SIZE, PREVIEW_SIZE)
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(path.join(mapDir, 'preview.jpg'));
  await sharp(labelsFile, { limitInputPixels: pixels })
    .resize(CARD_SIZE, CARD_SIZE)
    .webp({ quality: 72 })
    .toFile(path.join(mapDir, 'card.webp'));
  await sharp(labelsFile, { limitInputPixels: pixels })
    .resize(THUMB_SIZE, THUMB_SIZE)
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(path.join(mapDir, 'thumb.jpg'));

  // Low-res placeholder — format comes from magic bytes (Rondo's "png" is really a JPEG)
  const low = source(sources, map, 'lowres');
  const lowFile = path.join(REPO_DIR, low.repoPath);
  const lowSize = await measure(lowFile);
  await sharp(lowFile, { limitInputPixels: lowSize.pixels })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(path.join(mapDir, 'lowres.jpg'));
  console.log(
    `  extras preview ${PREVIEW_SIZE}px, card ${CARD_SIZE}px, thumb ${THUMB_SIZE}px, lowres ${lowSize.width}×${lowSize.height} (source ${low.format})`,
  );

  return {
    map,
    sourceSize: labels.sourceSize,
    paddedSize: labels.paddedSize,
    maxNativeZoom: labels.maxNativeZoom,
    variants,
    preview: `${map}/preview.jpg`,
    card: `${map}/card.webp`,
    thumbnail: `${map}/thumb.jpg`,
    lowres: {
      file: `${map}/lowres.jpg`,
      sourceFormat: low.format,
      sourceSize: lowSize.width,
      sha256: low.sha256,
    },
  };
}

/**
 * Phase 12: each loot icon fitted (aspect kept — weapons are ~3.5:1) into a transparent
 * ICON_SIZE square, WebP. Inputs are PNG by magic bytes (checked by fetch) and capped in size.
 */
async function buildIcons(
  sources: SourcesFile,
): Promise<{ dir: string; count: number; bytes: number }> {
  const dir = path.join(OUT_DIR, ICONS_DIR);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let bytes = 0;
  for (const icon of sources.icons ?? []) {
    const out = path.join(dir, `${icon.id}.webp`);
    await sharp(path.join(REPO_DIR, icon.repoPath), { limitInputPixels: 2048 * 2048 })
      .resize(ICON_SIZE, ICON_SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 85, alphaQuality: 90 })
      .toFile(out);
    bytes += statSync(out).size;
  }
  return { dir: ICONS_DIR, count: sources.icons?.length ?? 0, bytes };
}

async function main() {
  if (!existsSync(SOURCES_FILE)) {
    console.error(
      '✗ .cache/sources.json not found — run `pnpm --filter map-tiles run fetch` first',
    );
    process.exit(1);
  }
  const sources = JSON.parse(readFileSync(SOURCES_FILE, 'utf8')) as SourcesFile;
  const args = process.argv.slice(2).filter((a) => a !== '--');
  const selected = args.length > 0 ? args : [...MAPS];
  for (const m of selected) {
    if (!(MAPS as readonly string[]).includes(m)) {
      console.error(`✗ unknown map "${m}" (expected one of ${MAPS.join(', ')})`);
      process.exit(1);
    }
  }

  const manifestPath = path.join(OUT_DIR, 'manifest.json');
  const previous: Manifest | null = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest)
    : null;
  const manifest: Manifest = {
    version: 1,
    tileSize: TILE_SIZE,
    format: 'webp',
    layout: 'google',
    source: { repo: sources.repo, commit: sources.commit },
    generatedAt: new Date().toISOString(),
    maps: previous?.source.commit === sources.commit ? previous.maps : {},
    ...(previous?.source.commit === sources.commit && previous.icons
      ? { icons: previous.icons }
      : {}),
  };

  const started = Date.now();
  console.log(
    `Building tiles from ${sources.repo}@${sources.commit.slice(0, 10)} (webp q${TILE_QUALITY}) → ${OUT_DIR}`,
  );
  for (const map of selected as MapKey[]) {
    manifest.maps[map] = await buildMap(map, sources);
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`); // checkpoint per map
  }
  if (sources.icons?.length) {
    const icons = await buildIcons(sources);
    manifest.icons = icons;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(
      `  icons    ${icons.count} loot icons → out/${icons.dir} (${formatBytes(icons.bytes)})`,
    );
  } else {
    console.warn('  ⚠ no loot icons in .cache/sources.json — re-run fetch to get them (Phase 12)');
  }

  console.log('\nSummary');
  console.log('map      source px  padded  maxNativeZoom  tiles   size');
  for (const m of MAPS) {
    const e = manifest.maps[m];
    if (!e) continue;
    const tiles = e.variants.labels.tileCount + e.variants.clean.tileCount;
    const bytes = e.variants.labels.bytes + e.variants.clean.bytes;
    console.log(
      `${m.padEnd(8)} ${String(e.sourceSize).padStart(9)}  ${String(e.paddedSize).padStart(6)}  ${String(e.maxNativeZoom).padStart(13)}  ${String(tiles).padStart(5)}  ${formatBytes(bytes).padStart(9)}`,
    );
  }
  console.log(
    `\n✓ done in ${((Date.now() - started) / 1000).toFixed(1)} s — wrote out/manifest.json`,
  );
}

await main();
