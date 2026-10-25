/**
 * Downloads the PUBG map art (ARCHITECTURE §6 step 1):
 * sparse + shallow clone of pubg/api-assets, `git lfs pull` of only the files we use,
 * SHA-256 verification against the LFS pointer oid, format detection by magic bytes.
 *
 * Pure Node (no shell syntax) so it runs the same from PowerShell, cmd and Git Bash.
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileTypeFromFile } from 'file-type';
import {
  CACHE_DIR,
  MAPS,
  MAPS_PATH,
  REPO_DIR,
  REPO_REF,
  REPO_URL,
  SOURCES_FILE,
  formatBytes,
  run,
  sha256File,
  sourceFileName,
  type SourceEntry,
  type SourceKind,
  type SourcesFile,
} from './lib.js';

const KINDS: SourceKind[] = ['labels', 'clean', 'lowres'];

function requireGitLfs() {
  try {
    run('git', ['--version']);
  } catch {
    fail(
      'git is not installed or not on PATH. Install Git for Windows: https://git-scm.com/download/win',
    );
  }
  try {
    const v = run('git', ['lfs', 'version']).trim();
    console.log(`✓ ${v}`);
  } catch {
    fail(
      [
        'git-lfs is not installed. Install it, then re-run `pnpm --filter map-tiles run fetch`:',
        '  Windows:  winget install GitHub.GitLFS   (or it ships with Git for Windows — re-run the installer with "Git LFS" ticked)',
        '  macOS:    brew install git-lfs',
        '  Debian:   sudo apt install git-lfs',
        'then run once:  git lfs install',
      ].join('\n'),
    );
  }
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/** Parses a Git LFS pointer blob; returns null for a normal (non-LFS) blob. */
function parsePointer(text: string): { oid: string; size: number } | null {
  if (!text.startsWith('version https://git-lfs.github.com/spec/v1')) return null;
  const oid = /^oid sha256:([0-9a-f]{64})$/m.exec(text)?.[1];
  const size = /^size (\d+)$/m.exec(text)?.[1];
  if (!oid || !size) return null;
  return { oid, size: Number(size) };
}

async function main() {
  const started = Date.now();
  requireGitLfs();
  mkdirSync(CACHE_DIR, { recursive: true });

  const wanted = MAPS.flatMap((map) =>
    KINDS.map((kind) => ({ map, kind, repoPath: `${MAPS_PATH}/${sourceFileName(map, kind)}` })),
  );
  // Never let checkout smudge LFS files — we pull only the ones we want, explicitly.
  const noSmudge = { GIT_LFS_SKIP_SMUDGE: '1' };

  if (!existsSync(path.join(REPO_DIR, '.git'))) {
    console.log(`→ cloning ${REPO_URL} (${REPO_REF}) — sparse, shallow, blobless`);
    run(
      'git',
      [
        'clone',
        '--depth',
        '1',
        '--filter=blob:none',
        '--sparse',
        '--branch',
        REPO_REF,
        REPO_URL,
        REPO_DIR,
      ],
      { env: noSmudge },
    );
  } else {
    console.log('→ reusing existing clone in .cache/api-assets');
  }
  run('git', ['sparse-checkout', 'set', '--no-cone', ...wanted.map((w) => `/${w.repoPath}`)], {
    cwd: REPO_DIR,
    env: noSmudge,
  });
  const commit = run('git', ['rev-parse', 'HEAD'], { cwd: REPO_DIR }).trim();
  console.log(`✓ checked out ${commit}`);

  // Read the pointers straight from the commit (independent of the working-tree state).
  const pointers = new Map<string, { oid: string; size: number } | null>();
  for (const w of wanted) {
    let blob: string;
    try {
      blob = run('git', ['show', `HEAD:${w.repoPath}`], { cwd: REPO_DIR, env: noSmudge });
    } catch {
      fail(`${w.repoPath} not found in ${REPO_URL}@${commit}`);
    }
    // a pointer is ~130 bytes; a real image blob would be huge — only parse the head
    pointers.set(w.repoPath, parsePointer(blob.slice(0, 512)));
  }

  const lfsPaths = wanted.filter((w) => pointers.get(w.repoPath)).map((w) => w.repoPath);
  if (lfsPaths.length > 0) {
    console.log(`→ git lfs pull (${lfsPaths.length} files) — this can take a while (~650 MB)`);
    run('git', ['lfs', 'pull', `--include=${lfsPaths.join(',')}`], { cwd: REPO_DIR });
  }

  const files: SourceEntry[] = [];
  for (const w of wanted) {
    const abs = path.join(REPO_DIR, w.repoPath);
    if (!existsSync(abs)) fail(`${w.repoPath} missing after checkout`);
    const pointer = pointers.get(w.repoPath) ?? null;
    const bytes = statSync(abs).size;
    const sha256 = await sha256File(abs);
    if (pointer) {
      if (bytes !== pointer.size || sha256 !== pointer.oid) {
        fail(
          `${w.repoPath}: checksum mismatch (got ${sha256}, ${bytes} B; pointer says ${pointer.oid}, ${pointer.size} B)`,
        );
      }
    }
    const type = await fileTypeFromFile(abs);
    if (!type || !['png', 'jpg'].includes(type.ext)) {
      fail(`${w.repoPath}: not a PNG/JPEG by magic bytes (detected: ${type?.mime ?? 'unknown'})`);
    }
    const note = type.ext === 'png' ? '' : `  ⚠ ${type.ext.toUpperCase()} data despite .png name`;
    console.log(
      `✓ ${w.repoPath.padEnd(48)} ${formatBytes(bytes).padStart(9)}  ${type.ext}  ${pointer ? 'sha256 ok' : '(not in LFS)'}${note}`,
    );
    files.push({ ...w, sha256, bytes, format: type.ext, lfs: pointer !== null });
  }

  const sources: SourcesFile = {
    repo: REPO_URL,
    ref: REPO_REF,
    commit,
    fetchedAt: new Date().toISOString(),
    files,
  };
  writeFileSync(SOURCES_FILE, `${JSON.stringify(sources, null, 2)}\n`);
  console.log(`✓ wrote .cache/sources.json in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

await main();
