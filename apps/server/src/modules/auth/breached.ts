import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

// data/ sits next to src/ and dist/: src/modules/auth → ../../../data
const LIST_URL = new URL('../../../data/breached-passwords.txt.gz', import.meta.url);

let cache: ReadonlySet<string> | undefined;

/** Lower-cased NCSC top-100k entries of length 10–128 (see scripts/build-breached-list.ts). */
export function breachedPasswords(): ReadonlySet<string> {
  cache ??= new Set(
    gunzipSync(readFileSync(LIST_URL)).toString('utf8').split('\n').filter(Boolean),
  );
  return cache;
}

export function isBreachedPassword(password: string): boolean {
  return breachedPasswords().has(password.normalize('NFC').toLowerCase());
}
