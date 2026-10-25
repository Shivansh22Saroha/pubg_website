import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const PKG_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
export const CACHE_DIR = path.join(PKG_DIR, '.cache');
export const REPO_DIR = path.join(CACHE_DIR, 'api-assets');
export const SOURCES_FILE = path.join(CACHE_DIR, 'sources.json');
export const OUT_DIR = path.resolve(PKG_DIR, process.env.OUT_DIR ?? 'out');

export const REPO_URL = process.env.PUBG_ASSETS_REPO ?? 'https://github.com/pubg/api-assets';
export const REPO_REF = process.env.PUBG_ASSETS_REF ?? 'master';
export const MAPS_PATH = 'Assets/Maps';

export const MAPS = ['erangel', 'miramar', 'rondo'] as const;
export type MapKey = (typeof MAPS)[number];
export const VARIANTS = ['labels', 'clean'] as const;
export type Variant = (typeof VARIANTS)[number];
export type SourceKind = Variant | 'lowres';

const FILE_PREFIX: Record<MapKey, string> = {
  erangel: 'Erangel',
  miramar: 'Miramar',
  rondo: 'Rondo',
};

export function sourceFileName(map: MapKey, kind: SourceKind): string {
  const p = FILE_PREFIX[map];
  if (kind === 'labels') return `${p}_Main_High_Res.png`;
  if (kind === 'clean') return `${p}_Main_No_Text_High_Res.png`;
  return `${p}_Main_Low_Res.png`;
}

export interface SourceEntry {
  map: MapKey;
  kind: SourceKind;
  /** path relative to REPO_DIR, forward slashes */
  repoPath: string;
  sha256: string;
  bytes: number;
  /** detected from magic bytes, never from the extension */
  format: string;
  lfs: boolean;
}

export interface SourcesFile {
  repo: string;
  ref: string;
  commit: string;
  fetchedAt: string;
  files: SourceEntry[];
}

/** Runs a program without a shell, so it behaves the same under PowerShell, cmd and Git Bash. */
export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
) {
  return execFileSync(cmd, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
}

export function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => {
        resolve(hash.digest('hex'));
      });
  });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
