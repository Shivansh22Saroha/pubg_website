import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { processMapImage, sniffImage } from '../../src/modules/customMaps/service.js';

const solid = (width: number, height: number, format: 'png' | 'jpeg' | 'webp') =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 50, b: 50 } } })
    .toFormat(format)
    .toBuffer();

describe('custom map images (F20)', () => {
  it('sniffs JPEG, PNG and WebP by their bytes only', async () => {
    expect(sniffImage(await solid(10, 10, 'jpeg'))).toBe('jpeg');
    expect(sniffImage(await solid(10, 10, 'png'))).toBe('png');
    expect(sniffImage(await solid(10, 10, 'webp'))).toBe('webp');
    expect(sniffImage(Buffer.from('GIF89a'))).toBeNull();
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
  });

  it('shrinks big images to 4096 px and pads them square', async () => {
    const out = await processMapImage(await solid(5000, 2500, 'jpeg'));
    expect(out.sizePx).toBe(4096);
    const meta = await sharp(out.image).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(['webp', 4096, 4096]);
    expect(meta.exif).toBeUndefined();
  });

  it('applies EXIF rotation (a phone photo taken upright)', async () => {
    // 300×600 stored sideways (orientation 6 = rotate 90°) is really 600 wide
    const sideways = await sharp({
      create: { width: 600, height: 300, channels: 3, background: { r: 0, g: 0, b: 0 } },
    })
      .composite([
        {
          input: {
            create: { width: 300, height: 300, channels: 3, background: { r: 255, g: 0, b: 0 } },
          },
          left: 0,
          top: 0,
        },
      ])
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const out = await processMapImage(sideways);
    expect(out.sizePx).toBe(600);
    // rotated 90° clockwise: the red half is now the top half → top-centre is red, padding none
    const { data } = await sharp(out.image)
      .extract({ left: 300, top: 150, width: 1, height: 1 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(200);
  });
});
