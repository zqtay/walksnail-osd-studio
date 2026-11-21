import type { OsdData } from '../parsers/osd';

/**
 * Craft heading decoded from the OSD, used to orient the map's drone arrow.
 *
 * Two Betaflight elements are recognized:
 *
 * - Numerical heading: a direction arrow glyph (0x60..0x6F) followed by three
 *   digits, e.g. `{arrow}247`. 1° resolution. Accepted only when the arrow
 *   matches the number, which rules out other arrow+digit elements.
 * - Compass bar: a 9-glyph window into a repeating W..N..E..S strip
 *   (glyphs 0x18..0x1D), shifted in 22.5° steps. Verified against
 *   tests/fixtures/AscentG0245.osd, where it agrees with the GPS course.
 */

export interface HeadingSeries {
  /** OSD timeline time (ms) of each sample. */
  t: Float64Array;
  /** Heading in degrees clockwise from north, 0..360. */
  deg: Float64Array;
  source: 'numeric' | 'compass';
  /** Resolution of the source, in degrees. */
  resolutionDeg: number;
}

const SYM_HEADING_N = 0x18;
const SYM_HEADING_S = 0x19;
const SYM_HEADING_E = 0x1a;
const SYM_HEADING_W = 0x1b;
const SYM_HEADING_DIVIDED_LINE = 0x1c;
const SYM_HEADING_LINE = 0x1d;
const SYM_ARROW_SOUTH = 0x60;
const SYM_ARROW_LAST = 0x6f;

const L = SYM_HEADING_LINE;
const D = SYM_HEADING_DIVIDED_LINE;
/** Betaflight's compass strip; the bar shows 9 glyphs starting at sector k. */
const COMPASS_STRIP = [
  SYM_HEADING_W, L, D, L,
  SYM_HEADING_N, L, D, L,
  SYM_HEADING_E, L, D, L,
  SYM_HEADING_S, L, D, L,
  SYM_HEADING_W, L, D, L,
  SYM_HEADING_N, L, D, L,
];
const COMPASS_WIDTH = 9;
const SECTORS = 16;
const SECTOR_DEG = 360 / SECTORS;

/** Window contents -> sector index (heading = sector * 22.5°). */
const COMPASS_WINDOWS = new Map<string, number>();
for (let k = 0; k < SECTORS; k++) {
  COMPASS_WINDOWS.set(COMPASS_STRIP.slice(k, k + COMPASS_WIDTH).join(','), k);
}

/** Heading series found in an OSD, by source. */
export interface OsdHeadings {
  numeric?: HeadingSeries;
  compass?: HeadingSeries;
}

/** Where the drone arrow's heading comes from. */
export type HeadingPreference = 'numeric' | 'compass' | 'trail';

/** Fewest frames needed before a source is trusted. */
const MIN_FRAMES = 10;
/** Interpolate between samples only across gaps up to this long (ms). */
const MAX_INTERP_GAP_MS = 500;

/** Decode every heading element shown in the OSD. */
export function extractHeadings(osd: OsdData): OsdHeadings {
  const { cols, rows } = osd.header;
  const numeric: { t: number; deg: number }[] = [];
  const compass: { t: number; deg: number }[] = [];
  for (const frame of osd.frames) {
    const n = readNumericHeading(frame.glyphs, cols, rows);
    if (n !== undefined) numeric.push({ t: frame.t, deg: n });
    const c = readCompassBar(frame.glyphs, cols, rows);
    if (c !== undefined) compass.push({ t: frame.t, deg: c });
  }

  return {
    numeric: numeric.length >= MIN_FRAMES ? toSeries(numeric, 'numeric', 1) : undefined,
    compass: compass.length >= MIN_FRAMES ? toSeries(compass, 'compass', SECTOR_DEG) : undefined,
  };
}

/**
 * The heading series to use for a preference. An unavailable choice falls back
 * to the next best source (numeric -> compass -> trail); `undefined` means
 * infer the heading from the trail.
 */
export function resolveHeading(
  headings: OsdHeadings | undefined,
  preference: HeadingPreference,
): HeadingSeries | undefined {
  if (!headings || preference === 'trail') return undefined;
  if (preference === 'numeric') return headings.numeric ?? headings.compass;
  return headings.compass ?? headings.numeric;
}

/**
 * Heading (radians, clockwise from north) at `tMs`. Steps between OSD values
 * are turned into short rotations; long gaps (element missing) hold instead.
 */
export function headingAt(series: HeadingSeries, tMs: number): number {
  const { t, deg } = series;
  let lo = 0;
  let hi = t.length - 1;
  let i = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (t[mid] <= tMs) {
      i = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  let d: number;
  if (i < 0) d = deg[0];
  else if (i >= t.length - 1 || t[i + 1] - t[i] > MAX_INTERP_GAP_MS) d = deg[i];
  else {
    const f = (tMs - t[i]) / (t[i + 1] - t[i]);
    const delta = ((deg[i + 1] - deg[i] + 540) % 360) - 180; // shortest turn
    d = deg[i] + delta * f;
  }
  return (d * Math.PI) / 180;
}

/** Arrow glyph Betaflight draws for a heading (see osdGetDirectionSymbolFromHeading). */
function arrowForHeading(deg: number): number {
  const sector = Math.floor((deg * SECTORS + 180) / 360) % SECTORS;
  return SYM_ARROW_SOUTH + ((SECTORS - sector + 8) % SECTORS);
}

function isDigit(g: number): boolean {
  return g >= 0x30 && g <= 0x39;
}

function readNumericHeading(glyphs: Uint16Array, cols: number, rows: number): number | undefined {
  for (let r = 0; r < rows; r++) {
    const row = r * cols;
    for (let c = 0; c + 3 < cols; c++) {
      const g = glyphs[row + c];
      if (g < SYM_ARROW_SOUTH || g > SYM_ARROW_LAST) continue;
      const a = glyphs[row + c + 1];
      const b = glyphs[row + c + 2];
      const d = glyphs[row + c + 3];
      if (!isDigit(a) || !isDigit(b) || !isDigit(d)) continue;
      if (c + 4 < cols && isDigit(glyphs[row + c + 4])) continue;
      const deg = (a - 0x30) * 100 + (b - 0x30) * 10 + (d - 0x30);
      if (deg < 360 && arrowForHeading(deg) === g) return deg;
    }
  }
  return undefined;
}

function readCompassBar(glyphs: Uint16Array, cols: number, rows: number): number | undefined {
  for (let r = 0; r < rows; r++) {
    const row = r * cols;
    for (let c = 0; c + COMPASS_WIDTH <= cols; c++) {
      const g = glyphs[row + c];
      if (g < SYM_HEADING_N || g > SYM_HEADING_LINE) continue;
      let key = '';
      for (let j = 0; j < COMPASS_WIDTH; j++) key += (j ? ',' : '') + glyphs[row + c + j];
      const sector = COMPASS_WINDOWS.get(key);
      if (sector !== undefined) return sector * SECTOR_DEG;
    }
  }
  return undefined;
}

/**
 * Keep the first and last frame of each run of equal values, so interpolation
 * only spans the frame gap where the value actually changed.
 */
function toSeries(
  samples: { t: number; deg: number }[],
  source: HeadingSeries['source'],
  resolutionDeg: number,
): HeadingSeries {
  const t: number[] = [];
  const deg: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const prev = samples[i - 1];
    const next = samples[i + 1];
    const runStart = !prev || prev.deg !== s.deg;
    const runEnd = !next || next.deg !== s.deg;
    if (runStart || runEnd) {
      t.push(s.t);
      deg.push(s.deg);
    }
  }
  return { t: Float64Array.from(t), deg: Float64Array.from(deg), source, resolutionDeg };
}
