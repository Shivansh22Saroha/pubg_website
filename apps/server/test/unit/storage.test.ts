import { createHash } from 'node:crypto';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  assetKeyPattern,
  createLocalStorage,
  createS3Storage,
  signV4,
} from '../../src/lib/storage.js';

const AWS = {
  region: 'us-east-1',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  date: new Date('2013-05-24T00:00:00Z'),
};
const sigOf = (h: Record<string, string>) => /Signature=([0-9a-f]{64})/.exec(h.authorization!)?.[1];
const KEY = 'thumbnails/0192f7a1-0000-7000-8000-000000000001/AbCdEfGhIjKlMnOpQr_-12.jpg';

describe('SigV4 (AWS documented S3 examples)', () => {
  it('GET Object with Range', () => {
    const h = signV4({
      ...AWS,
      method: 'GET',
      host: 'examplebucket.s3.amazonaws.com',
      path: '/test.txt',
      headers: { range: 'bytes=0-9' },
      payloadHash: createHash('sha256').update('').digest('hex'),
    });
    expect(h.authorization).toContain(
      'Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request',
    );
    expect(h.authorization).toContain('SignedHeaders=host;range;x-amz-content-sha256;x-amz-date');
    expect(sigOf(h)).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  });

  it('PUT Object (path segment encoding)', () => {
    const body = 'Welcome to Amazon S3.';
    const h = signV4({
      ...AWS,
      method: 'PUT',
      host: 'examplebucket.s3.amazonaws.com',
      path: '/test$file.text',
      headers: {
        date: 'Fri, 24 May 2013 00:00:00 GMT',
        'x-amz-storage-class': 'REDUCED_REDUNDANCY',
      },
      payloadHash: createHash('sha256').update(body).digest('hex'),
    });
    expect(sigOf(h)).toBe('98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd');
  });
});

describe('S3 storage', () => {
  it('PUTs path-style with a signed, immutable object and maps keys to the public base', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));
    const s3 = createS3Storage({
      endpoint: 'https://acct.r2.cloudflarestorage.com',
      bucket: 'rotationlab-assets',
      region: 'auto',
      accessKeyId: 'id',
      secretAccessKey: 'secret',
      publicBaseUrl: 'https://assets.example.com/',
      fetch: fetchMock,
    });
    await s3.put(KEY, Buffer.from('jpeg'), 'image/jpeg');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://acct.r2.cloudflarestorage.com/rotationlab-assets/${KEY}`);
    expect(init.method).toBe('PUT');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=id\/\d{8}\/auto\/s3\//);
    expect(headers['content-type']).toBe('image/jpeg');
    expect(headers['cache-control']).toContain('immutable');
    expect(headers).not.toHaveProperty('host');
    expect(s3.url(KEY)).toBe(`https://assets.example.com/${KEY}`);
  });

  it('DELETE of a missing object is fine; other failures throw; bad keys are refused', async () => {
    const s3 = createS3Storage({
      endpoint: 'https://s3.example.com',
      bucket: 'b',
      region: 'auto',
      accessKeyId: 'id',
      secretAccessKey: 'secret',
      publicBaseUrl: 'https://cdn.example.com',
      fetch: () => Promise.resolve(new Response(null, { status: 404 })),
    });
    await expect(s3.remove(KEY)).resolves.toBeUndefined();
    await expect(s3.put(KEY, Buffer.from('x'), 'image/jpeg')).rejects.toThrow('HTTP 404');
    await expect(s3.put('../etc/passwd', Buffer.from('x'), 'image/jpeg')).rejects.toThrow(
      'refusing',
    );
  });
});

describe('local storage', () => {
  it('writes, reads and removes under its dir only', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'rl-assets-'));
    const local = createLocalStorage(dir);
    await local.put(KEY, Buffer.from('jpeg'), 'image/jpeg');
    expect((await local.read(KEY))?.toString()).toBe('jpeg');
    expect(local.url(KEY)).toBe(`/api/v1/assets/${KEY}`);
    expect(await local.read('thumbnails/../../etc/passwd')).toBeNull();
    await local.remove(KEY);
    await local.remove(KEY); // twice is fine
    expect(await local.read(KEY)).toBeNull();
    expect(await readdir(path.join(dir, 'thumbnails'))).toHaveLength(1); // the board dir
  });

  it('accepts only server-generated thumbnail keys', () => {
    expect(assetKeyPattern.test(KEY)).toBe(true);
    for (const bad of [
      'thumbnails/x/AbCdEfGhIjKlMnOpQr_-12.jpg',
      `${KEY}.png`,
      KEY.replace('thumbnails', 'avatars'),
    ])
      expect(assetKeyPattern.test(bad), bad).toBe(false);
  });
});
