import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Object storage for user assets — board thumbnails (Phase 11), custom map images (F20) and
 * profile photos (F23).
 * Two backends behind one interface: local disk (dev, tests, a single VM with a volume) and
 * S3-compatible storage (Cloudflare R2 / AWS S3) when the `S3_*` env vars are set. Keys are
 * generated server-side only (`assetKeyPattern`), never taken from a request.
 *
 * Custom map images and profile photos are **private** (SECURITY F20 / F23): the browser only ever gets a signed URL
 * that expires (`signedUrl`) — a presigned S3 GET, or an HMAC-signed link to the API's own
 * asset route on local disk. Signatures are issued per 6 h window and stay valid 12 h, so
 * the same URL comes back for hours and the browser cache keeps working.
 */
export interface AssetStorage {
  readonly kind: 'local' | 's3';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** best-effort delete; a missing object is fine */
  remove(key: string): Promise<void>;
  /** the URL the browser loads a (non-private) asset from */
  url(key: string): string;
  /** a URL that works until `expiresAt` (epoch ms) — for private assets */
  signedUrl(key: string, now?: number): { url: string; expiresAt: number };
  /** local backend: does this `exp` / `sig` open `key`? (S3 checks its own signatures) */
  verifySigned(key: string, exp: string | undefined, sig: string | undefined): boolean;
  /** local backend only: the bytes, for the API's own asset route */
  read(key: string): Promise<Buffer | null>;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
/**
 * The only keys we ever write: `thumbnails/<boardId>/<22-char random>.jpg`,
 * `maps/<roomId>/<22-char random>.webp` (+ `-512.webp`, its preview) and
 * `avatars/<userId>/<22-char random>.webp` (profile photos, F23)
 */
export const assetKeyPattern = new RegExp(
  `^(?:thumbnails/${UUID}/[A-Za-z0-9_-]{22}\\.jpg|maps/${UUID}/[A-Za-z0-9_-]{22}(?:-512)?\\.webp|avatars/${UUID}/[A-Za-z0-9_-]{22}\\.webp)$`,
);

/** private assets are only reachable through a signed URL */
export const isPrivateKey = (key: string) => key.startsWith('maps/') || key.startsWith('avatars/');

/** signatures are issued per window and live two windows (≥ 6 h left on any URL handed out) */
export const SIGN_WINDOW_MS = 6 * 60 * 60 * 1000;
export const SIGN_TTL_MS = 2 * SIGN_WINDOW_MS;
const windowStart = (now: number) => Math.floor(now / SIGN_WINDOW_MS) * SIGN_WINDOW_MS;

/** a key for local asset links derived from the JWT secret (never the secret itself) */
export function assetSigningSecret(jwtSecret: string): string {
  return createHmac('sha256', jwtSecret).update('rotationlab:asset-links').digest('hex');
}

/** local backend: `exp` (epoch s) + HMAC of key and exp — constant-time checked by the route */
export function localSignature(secret: string, key: string, exp: number): string {
  return createHmac('sha256', secret).update(`${key}\n${exp}`).digest('base64url');
}
export function verifyLocalSignature(
  secret: string,
  key: string,
  exp: string | undefined,
  sig: string | undefined,
  now = Date.now(),
): boolean {
  if (!exp || !sig || !/^\d{1,12}$/.test(exp)) return false;
  if (Number(exp) * 1000 <= now) return false;
  const want = Buffer.from(localSignature(secret, key, Number(exp)));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

function assertKey(key: string) {
  if (!assetKeyPattern.test(key)) throw new Error(`refusing asset key ${JSON.stringify(key)}`);
}

/**
 * Served by the API at `/api/v1/assets/<key>` (same origin, so no CSP change). Private keys
 * need `?exp=&sig=` signed with `secret`.
 */
export function createLocalStorage(dir: string, secret: string): AssetStorage {
  const root = path.resolve(dir);
  const fileOf = (key: string) => {
    assertKey(key);
    const file = path.resolve(root, key);
    if (!file.startsWith(root + path.sep)) throw new Error('asset path escapes the storage dir');
    return file;
  };
  return {
    kind: 'local',
    async put(key, body) {
      const file = fileOf(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, body);
    },
    async remove(key) {
      await rm(fileOf(key), { force: true });
    },
    url: (key) => `/api/v1/assets/${key}`,
    signedUrl(key, now = Date.now()) {
      assertKey(key);
      const expiresAt = windowStart(now) + SIGN_TTL_MS;
      const exp = expiresAt / 1000;
      return {
        url: `/api/v1/assets/${key}?exp=${exp}&sig=${localSignature(secret, key, exp)}`,
        expiresAt,
      };
    },
    verifySigned: (key, exp, sig) => verifyLocalSignature(secret, key, exp, sig),
    async read(key) {
      if (!assetKeyPattern.test(key)) return null;
      try {
        return await readFile(fileOf(key));
      } catch {
        return null;
      }
    },
  };
}

// ---- S3 / R2 (AWS Signature Version 4, path-style) -------------------------------------------

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: string | Buffer, data: string) =>
  createHmac('sha256', key).update(data).digest();

/** RFC 3986 encoding per path segment, as SigV4 wants it (S3: not double-encoded). */
const encodePath = (p: string) =>
  p
    .split('/')
    .map((seg) =>
      encodeURIComponent(seg).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/');

export interface SignInput {
  method: string;
  host: string;
  /** absolute path, unencoded */
  path: string;
  /** extra headers to sign (lower-case names), besides host / x-amz-date / x-amz-content-sha256 */
  headers?: Record<string, string>;
  payloadHash: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  date: Date;
}

/** Returns the headers to send (signed ones + Authorization). Exported for the test vector. */
export function signV4(i: SignInput): Record<string, string> {
  const amzDate = i.date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    host: i.host,
    'x-amz-content-sha256': i.payloadHash,
    'x-amz-date': amzDate,
    ...Object.fromEntries(Object.entries(i.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${String(headers[n]).trim()}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    i.method,
    encodePath(i.path),
    '',
    canonicalHeaders,
    signedHeaders,
    i.payloadHash,
  ].join('\n');
  const scope = `${day}/${i.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const kSigning = hmac(
    hmac(hmac(hmac(`AWS4${i.secretAccessKey}`, day), i.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/**
 * A presigned GET (SigV4 query auth, `UNSIGNED-PAYLOAD`), path-style. Exported for the test
 * vector.
 */
export function presignGetV4(i: {
  host: string;
  path: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  date: Date;
  expiresSec: number;
}): string {
  const amzDate = i.date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${i.region}/s3/aws4_request`;
  const params: [string, string][] = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${i.accessKeyId}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(i.expiresSec)],
    ['X-Amz-SignedHeaders', 'host'],
  ];
  const enc = (v: string) =>
    encodeURIComponent(v).replace(
      /[!'()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  const query = params
    .map(([k, v]) => [enc(k), enc(v)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  const canonicalRequest = [
    'GET',
    encodePath(i.path),
    query,
    `host:${i.host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n');
  const kSigning = hmac(
    hmac(hmac(hmac(`AWS4${i.secretAccessKey}`, day), i.region), 's3'),
    'aws4_request',
  );
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return `https://${i.host}${encodePath(i.path)}?${query}&X-Amz-Signature=${signature}`;
}

export interface S3Options {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /**
   * public base the browser loads thumbnails from (CDN / public bucket). Unset → private
   * bucket: thumbnails get signed URLs too. Custom maps are always signed.
   */
  publicBaseUrl?: string | undefined;
  fetch?: typeof fetch;
}

export function createS3Storage(o: S3Options): AssetStorage {
  const endpoint = new URL(o.endpoint);
  const doFetch = o.fetch ?? fetch;
  const base = o.publicBaseUrl?.replace(/\/$/, '');
  function signedUrl(key: string, now = Date.now()) {
    assertKey(key);
    const start = windowStart(now);
    const url = presignGetV4({
      host: endpoint.host,
      path: `${endpoint.pathname.replace(/\/$/, '')}/${o.bucket}/${key}`,
      region: o.region,
      accessKeyId: o.accessKeyId,
      secretAccessKey: o.secretAccessKey,
      date: new Date(start),
      expiresSec: SIGN_TTL_MS / 1000,
    });
    return { url, expiresAt: start + SIGN_TTL_MS };
  }
  async function request(method: 'PUT' | 'DELETE', key: string, body?: Buffer, type?: string) {
    assertKey(key);
    const objectPath = `${endpoint.pathname.replace(/\/$/, '')}/${o.bucket}/${key}`;
    const headers = signV4({
      method,
      host: endpoint.host,
      path: objectPath,
      headers: body
        ? {
            'content-type': type ?? 'application/octet-stream',
            // a new key per upload → objects never change
            'cache-control': 'public, max-age=31536000, immutable',
          }
        : {},
      payloadHash: sha256(body ?? ''),
      region: o.region,
      accessKeyId: o.accessKeyId,
      secretAccessKey: o.secretAccessKey,
      date: new Date(),
    });
    const { host: _host, ...sendHeaders } = headers; // fetch sets Host itself
    const res = await doFetch(`${endpoint.origin}${encodePath(objectPath)}`, {
      method,
      headers: sendHeaders,
      ...(body ? { body: new Uint8Array(body) } : {}),
    });
    if (!res.ok && !(method === 'DELETE' && res.status === 404)) {
      throw new Error(`S3 ${method} failed: HTTP ${res.status}`);
    }
  }
  return {
    kind: 's3',
    put: (key, body, type) => request('PUT', key, body, type),
    remove: (key) => request('DELETE', key),
    url: (key) => (base && !isPrivateKey(key) ? `${base}/${key}` : signedUrl(key).url),
    signedUrl,
    verifySigned: () => false,
    read: () => Promise.resolve(null),
  };
}

/**
 * The configured backend: S3 / R2 when the four S3_* credentials are set (config enforces
 * all-or-none); PUBLIC_ASSETS_BASE_URL is optional (a public bucket / CDN for thumbnails).
 * `signingSecret` signs local private-asset links.
 */
export function createAssetStorage(
  c: {
    S3_ENDPOINT?: string | undefined;
    S3_BUCKET?: string | undefined;
    S3_ACCESS_KEY_ID?: string | undefined;
    S3_SECRET_ACCESS_KEY?: string | undefined;
    S3_REGION: string;
    PUBLIC_ASSETS_BASE_URL?: string | undefined;
    ASSETS_DIR: string;
  },
  signingSecret: string,
): AssetStorage {
  if (c.S3_ENDPOINT && c.S3_BUCKET && c.S3_ACCESS_KEY_ID && c.S3_SECRET_ACCESS_KEY) {
    return createS3Storage({
      endpoint: c.S3_ENDPOINT,
      bucket: c.S3_BUCKET,
      region: c.S3_REGION,
      accessKeyId: c.S3_ACCESS_KEY_ID,
      secretAccessKey: c.S3_SECRET_ACCESS_KEY,
      publicBaseUrl: c.PUBLIC_ASSETS_BASE_URL,
    });
  }
  return createLocalStorage(c.ASSETS_DIR, signingSecret);
}
