/**
 * Walksnail `.osd` binary parser.
 *
 * Verified layout (from docs/examples/AscentG0177.osd):
 *   Header = 40 bytes, little-endian:
 *     0..3   ASCII magic, e.g. "BTFL" (FC firmware id; INAV/ARDU/etc. possible)
 *     4..31  reserved / name, null-padded
 *     32..35 u32 unknown (value 200 in sample; do not depend on it)
 *     36..37 u16 cols  (53 in sample)
 *     38..39 u16 rows  (20 in sample)
 *   Frame stream from offset 40, repeated to EOF:
 *     u32 timestamp_ms
 *     u16 glyphs[cols * rows]   // row-major font atlas indices; 0x20 = space
 *   frameSize = 4 + cols * rows * 2
 */

export const OSD_HEADER_SIZE = 40;
export const OSD_GLYPH_SPACE = 0x20;

export interface OsdHeader {
  magic: string;
  unknown32: number;
  cols: number;
  rows: number;
}

export interface OsdFrame {
  /** Display time in milliseconds. */
  t: number;
  /** cols*rows font-atlas glyph indices, row-major. */
  glyphs: Uint16Array;
}

export interface OsdData {
  header: OsdHeader;
  frames: OsdFrame[];
  /** Timestamp of the last frame, in ms. */
  durationMs: number;
}

export class OsdParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OsdParseError';
  }
}

// Sanity caps to protect against malformed/hostile headers.
const MAX_DIM = 4096; // cols/rows upper bound
const MAX_FRAMES = 5_000_000;

/**
 * Parse a Walksnail `.osd` file.
 * @param buffer Raw file bytes.
 */
export function parseOsd(buffer: ArrayBuffer): OsdData {
  if (buffer.byteLength < OSD_HEADER_SIZE) {
    throw new OsdParseError(
      `File too small: ${buffer.byteLength} bytes (need >= ${OSD_HEADER_SIZE}).`,
    );
  }

  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const magic = asciiString(bytes, 0, 4);
  const unknown32 = view.getUint32(32, true);
  const cols = view.getUint16(36, true);
  const rows = view.getUint16(38, true);

  if (cols === 0 || rows === 0 || cols > MAX_DIM || rows > MAX_DIM) {
    throw new OsdParseError(`Invalid grid dimensions: cols=${cols}, rows=${rows}.`);
  }

  const cells = cols * rows;
  const frameSize = 4 + cells * 2;
  const dataLen = buffer.byteLength - OSD_HEADER_SIZE;

  if (dataLen % frameSize !== 0) {
    throw new OsdParseError(
      `Frame data length ${dataLen} is not a multiple of frameSize ${frameSize} ` +
        `(cols=${cols}, rows=${rows}). File may be truncated or the format differs.`,
    );
  }

  const frameCount = dataLen / frameSize;
  if (frameCount > MAX_FRAMES) {
    throw new OsdParseError(`Implausible frame count: ${frameCount}.`);
  }

  const frames: OsdFrame[] = new Array(frameCount);
  let offset = OSD_HEADER_SIZE;
  for (let i = 0; i < frameCount; i++) {
    const t = view.getUint32(offset, true);
    offset += 4;
    // Copy glyphs into an independent buffer (little-endian u16).
    const glyphs = new Uint16Array(cells);
    for (let g = 0; g < cells; g++) {
      glyphs[g] = view.getUint16(offset, true);
      offset += 2;
    }
    frames[i] = { t, glyphs };
  }

  const durationMs = frameCount > 0 ? frames[frameCount - 1].t : 0;

  return {
    header: { magic, unknown32, cols, rows },
    frames,
    durationMs,
  };
}

/**
 * Return the index of the active frame for a given time using step/hold:
 * the greatest frame whose timestamp is <= tMs. Returns -1 if none.
 * O(log n) binary search over the sorted timestamps.
 */
export function osdFrameIndexAt(frames: OsdFrame[], tMs: number): number {
  let lo = 0;
  let hi = frames.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (frames[mid].t <= tMs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

function asciiString(bytes: Uint8Array, start: number, len: number): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    const c = bytes[start + i];
    if (c === 0) break;
    out += String.fromCharCode(c);
  }
  return out;
}
