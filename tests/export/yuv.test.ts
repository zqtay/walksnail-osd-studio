import { describe, it, expect } from 'vitest';
import { rgbaToI420 } from '../../src/lib/export/yuv';

/** Build a solid RGBA image. */
function solid(w: number, h: number, r: number, g: number, b: number): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set([r, g, b, 255], i * 4);
  return px;
}

describe('rgbaToI420', () => {
  it('maps black and white to limited-range luma with neutral chroma', () => {
    const black = rgbaToI420(solid(4, 2, 0, 0, 0), 4, 2);
    const white = rgbaToI420(solid(4, 2, 255, 255, 255), 4, 2);
    expect(Array.from(black)).toEqual([...Array(8).fill(16), 128, 128, 128, 128]);
    expect(Array.from(white)).toEqual([...Array(8).fill(235), 128, 128, 128, 128]);
  });

  it('uses BT.709 coefficients for primaries', () => {
    // Reference 8-bit BT.709 limited-range values.
    const [y, u, v] = rgbaToI420(solid(1, 1, 255, 0, 0), 1, 1);
    expect([y, u, v]).toEqual([63, 102, 240]);
    const [yb, ub, vb] = rgbaToI420(solid(1, 1, 0, 0, 255), 1, 1);
    expect([yb, ub, vb]).toEqual([32, 240, 118]);
  });

  it('handles odd dimensions with rounded-up chroma planes', () => {
    expect(rgbaToI420(solid(3, 3, 0, 0, 0), 3, 3).length).toBe(9 + 2 * 4);
  });
});
