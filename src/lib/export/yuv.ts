import { VideoSample } from 'mediabunny';

// BT.709 luma weights.
const KR = 0.2126;
const KB = 0.0722;
const KG = 1 - KR - KB;

// Fixed-point (16-bit) coefficients for 8-bit limited ("tv") range output:
// Y in [16, 235], Cb/Cr in [16, 240].
const FIX = 1 << 16;
const HALF = 1 << 15;
const yScale = (219 / 255) * FIX;
const cScale = (224 / 255) * FIX;
const Y_R = Math.round(KR * yScale);
const Y_G = Math.round(KG * yScale);
const Y_B = Math.round(KB * yScale);
const CB_R = Math.round((-KR / (2 * (1 - KB))) * cScale);
const CB_G = Math.round((-KG / (2 * (1 - KB))) * cScale);
const CB_B = Math.round(0.5 * cScale);
const CR_R = Math.round(0.5 * cScale);
const CR_G = Math.round((-KG / (2 * (1 - KR))) * cScale);
const CR_B = Math.round((-KB / (2 * (1 - KR))) * cScale);

/** Color space of the I420 data produced by {@link rgbaToI420}. */
export const BT709_LIMITED: VideoColorSpaceInit = {
  primaries: 'bt709',
  transfer: 'bt709',
  matrix: 'bt709',
  fullRange: false,
};

/**
 * Convert tightly packed RGBA pixels to planar I420 (4:2:0) using the BT.709
 * matrix in limited range. Chroma is the average of each 2x2 block; odd edges
 * reuse the last row/column.
 */
export function rgbaToI420(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Uint8Array {
  const cw = Math.ceil(width / 2);
  const ch = Math.ceil(height / 2);
  const out = new Uint8Array(width * height + 2 * cw * ch);
  const uOff = width * height;
  const vOff = uOff + cw * ch;

  for (let i = 0, p = 0; i < width * height; i++, p += 4) {
    out[i] = 16 + ((Y_R * rgba[p] + Y_G * rgba[p + 1] + Y_B * rgba[p + 2] + HALF) >> 16);
  }

  for (let cy = 0; cy < ch; cy++) {
    const row0 = 2 * cy * width;
    const row1 = Math.min(2 * cy + 1, height - 1) * width;
    for (let cx = 0; cx < cw; cx++) {
      const x0 = 2 * cx;
      const x1 = Math.min(x0 + 1, width - 1);
      const a = (row0 + x0) * 4;
      const b = (row0 + x1) * 4;
      const c = (row1 + x0) * 4;
      const d = (row1 + x1) * 4;
      // Sum of four pixels; the extra >> 2 below averages them.
      const r = rgba[a] + rgba[b] + rgba[c] + rgba[d];
      const g = rgba[a + 1] + rgba[b + 1] + rgba[c + 1] + rgba[d + 1];
      const bl = rgba[a + 2] + rgba[b + 2] + rgba[c + 2] + rgba[d + 2];
      const ci = cy * cw + cx;
      out[uOff + ci] = 128 + ((CB_R * r + CB_G * g + CB_B * bl + (HALF << 2)) >> 18);
      out[vOff + ci] = 128 + ((CR_R * r + CR_G * g + CR_B * bl + (HALF << 2)) >> 18);
    }
  }
  return out;
}

/**
 * Snapshot a 2D canvas into a limited-range BT.709 I420 sample for encoding.
 *
 * Handing the encoder an RGB canvas frame directly makes Chrome emit
 * full-range video tagged with the sRGB transfer function, which
 * color-managed players render with lower contrast than typical camera
 * footage (BT.709, limited range). Converting ourselves keeps the export
 * consistent with the source.
 */
export function canvasToVideoSample(
  ctx: CanvasRenderingContext2D,
  timestamp: number,
  duration: number,
): VideoSample {
  const { width, height } = ctx.canvas;
  const rgba = ctx.getImageData(0, 0, width, height).data;
  return new VideoSample(rgbaToI420(rgba, width, height), {
    format: 'I420',
    codedWidth: width,
    codedHeight: height,
    timestamp,
    duration,
    colorSpace: BT709_LIMITED,
  });
}
