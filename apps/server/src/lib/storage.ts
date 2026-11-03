import { createHash, createHmac } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Object storage for user assets — board thumbnails (Phase 11). Two backends behind one
 * interface: local disk (dev, tests, a single VM with a volume) and S3-compatible storage
 * (Cloudflare R2 / AWS S3) when the `S3_*` env vars are set. Keys are generated server-side
 * only (`assetKeyPattern`), never taken from a request.
 */
export interface AssetStorage {
  readonly kind: 'local' | 's3';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** best-effort delete; a missing object is fine */
  remove(key: string): Promise<void>;
  /** public URL the browser loads */
  url(key: string): string;
  /** local backend only: the bytes, for the API's own asset route */
  read(key: string): Promise<Buffer | null>;
}

/** `thumbnails/<boardId>/<22-char random>.jpg` — the only keys we ever write */
export const assetKeyPattern =
  /^thumbnails\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[A-Za-z0-9_-]{22}\.jpg$/;

function assertKey(key: string) {
  if (!assetKeyPattern.test(key)) throw new Error(`refusing asset key ${JSON.stringify(key)}`);
}

/** Served by the API at `/api/v1/assets/<key>` (same origin, so no CSP change). */
export function createLocalStorage(dir: string): AssetStorage {
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

export interface S3Options {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** public base the browser loads objects from (CDN / R2 custom domain) */
  publicBaseUrl: string;
  fetch?: typeof fetch;
}

export function createS3Storage(o: S3Options): AssetStorage {
  const endpoint = new URL(o.endpoint);
  const doFetch = o.fetch ?? fetch;
  const base = o.publicBaseUrl.replace(/\/$/, '');
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
    url: (key) => `${base}/${key}`,
    read: () => Promise.resolve(null),
  };
}

/** The configured backend: S3 / R2 when every S3_* value is set (config enforces all-or-none). */
export function createAssetStorage(c: {
  S3_ENDPOINT?: string | undefined;
  S3_BUCKET?: string | undefined;
  S3_ACCESS_KEY_ID?: string | undefined;
  S3_SECRET_ACCESS_KEY?: string | undefined;
  S3_REGION: string;
  PUBLIC_ASSETS_BASE_URL?: string | undefined;
  ASSETS_DIR: string;
}): AssetStorage {
  if (
    c.S3_ENDPOINT &&
    c.S3_BUCKET &&
    c.S3_ACCESS_KEY_ID &&
    c.S3_SECRET_ACCESS_KEY &&
    c.PUBLIC_ASSETS_BASE_URL
  ) {
    return createS3Storage({
      endpoint: c.S3_ENDPOINT,
      bucket: c.S3_BUCKET,
      region: c.S3_REGION,
      accessKeyId: c.S3_ACCESS_KEY_ID,
      secretAccessKey: c.S3_SECRET_ACCESS_KEY,
      publicBaseUrl: c.PUBLIC_ASSETS_BASE_URL,
    });
  }
  return createLocalStorage(c.ASSETS_DIR);
}
