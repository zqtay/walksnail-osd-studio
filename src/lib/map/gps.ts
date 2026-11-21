import { OSD_GLYPH_SPACE, type OsdData } from '../parsers/osd';
import { haversineM } from './geo';
import { extractHeadings, type OsdHeadings } from './heading';

/**
 * GPS extraction from a Walksnail `.osd` recording.
 *
 * The `.osd` file stores no telemetry, only the font-glyph grid shown on screen.
 * When the pilot enables the flight controller's GPS latitude/longitude OSD
 * elements, each coordinate is drawn as a marker glyph followed by ASCII digits,
 * e.g. Betaflight (verified from tests/fixtures/AscentG0245.osd):
 *
 *   {0x89}1.3088943       latitude
 *   {0x98}103.8682240     longitude
 *   {0x11}16{0x0C}        home distance (home flag + metres)
 *
 * We scan every frame for the marker glyphs and parse the number that follows,
 * so detection works wherever the elements sit on screen (and even when they
 * are masked from the rendered output).
 */

/** Marker glyphs a flight-controller firmware uses for its GPS elements. */
interface GpsSymbolSet {
  name: string;
  lat: number;
  lon: number;
  /** Glyph preceding the home-distance value (used to locate the arming fix). */
  home?: number;
}

/**
 * Known marker glyphs. Every set is tried and the one yielding the most valid
 * fixes wins, so detection does not rely on the header's firmware magic.
 * Betaflight is verified against a real recording; INAV/ArduPilot share the
 * INAV font layout (SYM_LAT 0xA6 / SYM_LON 0xA7) and are not yet verified.
 */
const SYMBOL_SETS: GpsSymbolSet[] = [
  { name: 'Betaflight', lat: 0x89, lon: 0x98, home: 0x11 },
  { name: 'INAV / ArduPilot', lat: 0xa6, lon: 0xa7 },
];

const CHAR_0 = 0x30;
const CHAR_9 = 0x39;
const CHAR_DOT = 0x2e;
const CHAR_MINUS = 0x2d;

/** Coordinates need at least this many decimals to be useful for a trail. */
const COORD_RE = /^-?\d{1,3}\.\d{4,}$/;
const DISTANCE_RE = /^\d+(\.\d+)?$/;

/** Reject a fix that implies flying faster than this (m/s) from the last one. */
const MAX_SPEED_MS = 120;
/** ...unless the jump is this small (m), which covers GPS jitter at low dt. */
const MIN_OUTLIER_JUMP_M = 30;
/** After this many consecutive rejections, accept and re-anchor the track. */
const MAX_CONSECUTIVE_REJECTS = 5;
/** A value held unchanged longer than this (ms) gets an end-of-hold sample. */
const HOLD_SAMPLE_MS = 500;

export interface GpsPoint {
  /** OSD timeline time in ms. */
  t: number;
  lat: number;
  lon: number;
}

export interface GpsTrack {
  /** Cleaned, time-ordered fixes. */
  points: GpsPoint[];
  /** Home position, if one could be determined. */
  home?: { lat: number; lon: number };
  /** How the home point was found. */
  homeSource?: 'arming' | 'first-fix';
  /** Firmware whose marker glyphs matched. */
  source: string;
  /** Craft heading elements found in the OSD (orient the drone arrow). */
  headings: OsdHeadings;
}

/**
 * Extract the GPS track from parsed OSD data.
 * @returns The track, or `undefined` when no coordinates are drawn in the OSD.
 */
export function extractGpsTrack(osd: OsdData): GpsTrack | undefined {
  const { cols, rows } = osd.header;
  let best: { set: GpsSymbolSet; raw: RawFix[] } | undefined;

  for (const set of SYMBOL_SETS) {
    const raw: RawFix[] = [];
    for (const frame of osd.frames) {
      const lat = readNumberAfter(frame.glyphs, cols, rows, set.lat, COORD_RE);
      if (lat === undefined || Math.abs(lat) > 90) continue;
      const lon = readNumberAfter(frame.glyphs, cols, rows, set.lon, COORD_RE);
      if (lon === undefined || Math.abs(lon) > 180) continue;
      // 0,0 is what firmwares show before the first fix.
      if (lat === 0 && lon === 0) continue;
      const homeKnown =
        set.home !== undefined &&
        readNumberAfter(frame.glyphs, cols, rows, set.home, DISTANCE_RE) !== undefined;
      raw.push({ t: frame.t, lat, lon, homeKnown });
    }
    if (raw.length > (best?.raw.length ?? 0)) best = { set, raw };
  }

  if (!best || best.raw.length < 2) return undefined;

  const points = rejectOutliers(dedupe(best.raw));
  if (points.length < 2) return undefined;

  // Betaflight sets home at arming; the home-distance element switches from
  // "-" to a number at that moment, so the first fix with a number is home.
  const armed = best.raw.find((f) => f.homeKnown);
  const home = armed ?? points[0];

  return {
    points,
    home: { lat: home.lat, lon: home.lon },
    homeSource: armed ? 'arming' : 'first-fix',
    source: best.set.name,
    headings: extractHeadings(osd),
  };
}

interface RawFix extends GpsPoint {
  homeKnown: boolean;
}

/**
 * Find `marker` in the grid and parse the number drawn right after it on the
 * same row. Tries every occurrence and returns the first that matches `re`.
 */
function readNumberAfter(
  glyphs: Uint16Array,
  cols: number,
  rows: number,
  marker: number,
  re: RegExp,
): number | undefined {
  const cells = cols * rows;
  for (let i = 0; i < cells; i++) {
    if (glyphs[i] !== marker) continue;
    const rowEnd = (Math.floor(i / cols) + 1) * cols;
    let s = '';
    for (let j = i + 1; j < rowEnd; j++) {
      const g = glyphs[j];
      if ((g >= CHAR_0 && g <= CHAR_9) || g === CHAR_DOT) s += String.fromCharCode(g);
      else if (g === CHAR_MINUS && s === '') s = '-';
      else if (g === OSD_GLYPH_SPACE && s === '') continue; // tolerate padding
      else break;
    }
    if (re.test(s)) return Number(s);
  }
  return undefined;
}

/**
 * Collapse runs of identical fixes (the OSD redraws faster than GPS updates).
 * Each new value is timed at its first appearance; a long-held value also gets
 * a sample at the end of its run so interpolation doesn't smear a hover into
 * the next movement.
 */
function dedupe(raw: RawFix[]): GpsPoint[] {
  const out: GpsPoint[] = [];
  let runStart: RawFix | undefined;
  let runLast: RawFix | undefined;
  for (const f of raw) {
    if (runStart && f.lat === runStart.lat && f.lon === runStart.lon) {
      runLast = f;
      continue;
    }
    if (runStart && runLast && runLast.t - runStart.t > HOLD_SAMPLE_MS) {
      out.push({ t: runLast.t, lat: runLast.lat, lon: runLast.lon });
    }
    out.push({ t: f.t, lat: f.lat, lon: f.lon });
    runStart = f;
    runLast = f;
  }
  if (runStart && runLast && runLast !== runStart) {
    out.push({ t: runLast.t, lat: runLast.lat, lon: runLast.lon });
  }
  return out;
}

/** Drop fixes that would require an implausible speed from the previous one. */
function rejectOutliers(points: GpsPoint[]): GpsPoint[] {
  const out: GpsPoint[] = [];
  let rejects = 0;
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev) {
      const d = haversineM(prev.lat, prev.lon, p.lat, p.lon);
      const dt = Math.max(1, p.t - prev.t) / 1000;
      if (d > MIN_OUTLIER_JUMP_M && d / dt > MAX_SPEED_MS && rejects < MAX_CONSECUTIVE_REJECTS) {
        rejects++;
        continue;
      }
    }
    rejects = 0;
    out.push(p);
  }
  return out;
}
