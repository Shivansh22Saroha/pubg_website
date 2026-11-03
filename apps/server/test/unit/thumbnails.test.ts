import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { reencodeThumbnail } from '../../src/modules/thumbnails/service.js';

const make = (w: number, h: number) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#224466' } })
    .jpeg()
    .toBuffer();

describe('reencodeThumbnail (Phase 11)', () => {
  it('returns a fresh 256×256 JPEG', async () => {
    const out = await reencodeThumbnail(await make(256, 256));
    const meta = await sharp(out).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['jpeg', 256, 256]);
  });

  it('rejects other sizes, other formats and non-images', async () => {
    await expect(reencodeThumbnail(await make(512, 512))).rejects.toThrow(/256×256 JPEG/);
    const png = await sharp({
      create: { width: 256, height: 256, channels: 3, background: '#000' },
    })
      .png()
      .toBuffer();
    await expect(reencodeThumbnail(png)).rejects.toThrow(/256×256 JPEG/);
    await expect(reencodeThumbnail(Buffer.from([0xff, 0xd8, 0xff, 0, 0]))).rejects.toThrow(
      /256×256 JPEG/,
    );
    await expect(reencodeThumbnail(Buffer.alloc(0))).rejects.toThrow(/256×256 JPEG/);
  });
});
