/**
 * Regenerates data/breached-passwords.txt.gz (SECURITY A2).
 *
 * Source: NCSC "100k most used passwords" (derived from Have I Been Pwned), mirrored in
 * SecLists (MIT). Only entries that could pass our length policy (10–128 chars) can ever
 * match, so the bundled file keeps just those, lower-cased and de-duplicated.
 *
 *   pnpm --filter server exec tsx scripts/build-breached-list.ts
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const SOURCE =
  'https://raw.githubusercontent.com/danielmiessler/SecLists/master/Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt';
const OUT = fileURLToPath(new URL('../data/breached-passwords.txt.gz', import.meta.url));

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
const text = await res.text();
const sha256 = createHash('sha256').update(text).digest('hex');

// hashcat-style `$hex[...]` lines encode passwords containing awkward bytes
const decode = (line: string) => {
  const hex = /^\$hex\[([0-9a-f]+)\]$/i.exec(line)?.[1];
  return hex ? Buffer.from(hex, 'hex').toString('utf8') : line;
};
const all = text.split(/\r?\n/).filter(Boolean).map(decode);
const kept = [
  ...new Set(
    all
      .map((p) => p.normalize('NFC').toLowerCase())
      .filter((p) => Array.from(p).length >= 10 && Array.from(p).length <= 128),
  ),
].sort();

mkdirSync(fileURLToPath(new URL('../data/', import.meta.url)), { recursive: true });
const gz = gzipSync(`${kept.join('\n')}\n`, { level: 9 });
writeFileSync(OUT, gz);
console.log(
  `source ${all.length} entries (sha256 ${sha256}) → kept ${kept.length} with length 10–128 → ${gz.length} bytes gzipped`,
);
