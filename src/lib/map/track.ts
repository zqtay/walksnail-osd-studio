import type { GpsPoint, GpsTrack } from './gps';
import { latToWorldY, lonToWorldX } from './geo';
import { headingAt, type HeadingSeries } from './heading';

/** Gaussian sigma (ms) at 100% smoothing. */
const MAX_SIGMA_MS = 2500;

/** Movement (m) needed before a heading is derived from the trail. */
const HEADING_MIN_MOVE_M = 3;
/** How far back (ms) to look for that movement. */
const HEADING_LOOKBACK_MS = 10_000;

/** Metres per world unit at the equator (Earth circumference). */
const EQUATOR_M = 40_075_016.686;

/** A GPS track projected to world coordinates and ready to sample. */
export interface PreparedTrack {
  t: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  /** Normalized Web Mercator x/y. */
  x: Float64Array;
  y: Float64Array;
  home?: { lat: number; lon: number; x: number; y: number };
  /** World-space bounding box of the trail (and home). */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Metres per world unit at the trail's latitude. */
  metersPerUnit: number;
}

/** A sampled drone position. */
export interface TrackSample {
  x: number;
  y: number;
  lat: number;
  lon: number;
  /** Index of the last track point at or before the sample time. */
  index: number;
  /**
   * Heading in radians, clockwise from north: from the given OSD heading
   * series, otherwise the trail direction (undefined while stationary).
   */
  heading?: number;
}

/**
 * Gaussian-smooth a track in time. `amount` is 0..100 (%). Time-based weights
 * handle the uneven sample spacing of OSD-derived fixes.
 */
export function smoothPoints(points: GpsPoint[], amount: number): GpsPoint[] {
  const sigma = (Math.max(0, Math.min(100, amount)) / 100) * MAX_SIGMA_MS;
  if (sigma < 1 || points.length < 3) return points;

  const radius = sigma * 3;
  const inv2s2 = 1 / (2 * sigma * sigma);
  const out: GpsPoint[] = new Array(points.length);
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < points.length; i++) {
    const t = points[i].t;
    while (points[lo].t < t - radius) lo++;
    while (hi + 1 < points.length && points[hi + 1].t <= t + radius) hi++;
    let wSum = 0;
    let latSum = 0;
    let lonSum = 0;
    for (let j = lo; j <= hi; j++) {
      const dt = points[j].t - t;
      const w = Math.exp(-dt * dt * inv2s2);
      wSum += w;
      latSum += points[j].lat * w;
      lonSum += points[j].lon * w;
    }
    out[i] = { t, lat: latSum / wSum, lon: lonSum / wSum };
  }
  // Pin the endpoints so the trail still starts and ends where the flight did.
  out[0] = points[0];
  out[out.length - 1] = points[points.length - 1];
  return out;
}

/** Project and index a track for rendering. */
export function prepareTrack(track: GpsTrack, smoothing: number): PreparedTrack {
  const pts = smoothPoints(track.points, smoothing);
  const n = pts.length;
  const t = new Float64Array(n);
  const lat = new Float64Array(n);
  const lon = new Float64Array(n);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    t[i] = pts[i].t;
    lat[i] = pts[i].lat;
    lon[i] = pts[i].lon;
    x[i] = lonToWorldX(pts[i].lon);
    y[i] = latToWorldY(pts[i].lat);
    minX = Math.min(minX, x[i]);
    maxX = Math.max(maxX, x[i]);
    minY = Math.min(minY, y[i]);
    maxY = Math.max(maxY, y[i]);
  }

  let home: PreparedTrack['home'];
  if (track.home) {
    home = {
      ...track.home,
      x: lonToWorldX(track.home.lon),
      y: latToWorldY(track.home.lat),
    };
    minX = Math.min(minX, home.x);
    maxX = Math.max(maxX, home.x);
    minY = Math.min(minY, home.y);
    maxY = Math.max(maxY, home.y);
  }

  const midLat = n > 0 ? lat[Math.floor(n / 2)] : 0;
  const metersPerUnit = EQUATOR_M * Math.cos((midLat * Math.PI) / 180);

  return {
    t,
    lat,
    lon,
    x,
    y,
    home,
    bounds: { minX, minY, maxX, maxY },
    metersPerUnit,
  };
}

// Smoothing is recomputed only when the track or smoothing amount changes; the
// renderer runs every frame and would otherwise redo it each time.
const prepared = new WeakMap<GpsTrack, { smoothing: number; value: PreparedTrack }>();

/** Memoized `prepareTrack` (one cached smoothing level per track). */
export function getPreparedTrack(track: GpsTrack, smoothing: number): PreparedTrack {
  const hit = prepared.get(track);
  if (hit && hit.smoothing === smoothing) return hit.value;
  const value = prepareTrack(track, smoothing);
  prepared.set(track, { smoothing, value });
  return value;
}

/** Index of the last point with `t <= tMs`, or -1 when before the first. */
function indexAt(t: Float64Array, tMs: number): number {
  let lo = 0;
  let hi = t.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (t[mid] <= tMs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/**
 * Sample the drone position at a time, linearly interpolating between fixes
 * and clamping to the first/last fix outside the recorded range. The heading
 * comes from `osdHeading` (an OSD heading series) when given, else the trail.
 */
export function sampleTrack(
  track: PreparedTrack,
  tMs: number,
  osdHeading?: HeadingSeries,
): TrackSample {
  const n = track.t.length;
  const { x, y, lat, lon, index: i } = interpolate(track, tMs);

  if (osdHeading) {
    return { x, y, lat, lon, index: i, heading: headingAt(osdHeading, tMs) };
  }

  // Trail direction from the most recent point far enough behind us.
  let heading: number | undefined;
  const minMove = HEADING_MIN_MOVE_M / track.metersPerUnit;
  for (let j = Math.min(i, n - 1); j >= 0; j--) {
    if (tMs - track.t[j] > HEADING_LOOKBACK_MS) break;
    const dx = x - track.x[j];
    const dy = y - track.y[j];
    if (dx * dx + dy * dy >= minMove * minMove) {
      heading = Math.atan2(dx, -dy);
      break;
    }
  }

  return { x, y, lat, lon, index: i, heading };
}

/** World-space polylines for the flown and upcoming parts of the trail. */
export interface TrailPolylines {
  /** Flown part (within the trail window), ending at the drone. */
  past: [number, number][];
  /** Upcoming part, starting at the drone. */
  future: [number, number][];
}

/**
 * Split the trail at `tMs`. With `pastSeconds > 0`, the flown part only covers
 * the last `pastSeconds` and starts at the interpolated position at that time;
 * 0 keeps the whole flown trail.
 */
export function trailPolylines(
  track: PreparedTrack,
  tMs: number,
  pastSeconds: number,
): TrailPolylines {
  const n = track.t.length;
  const now = interpolate(track, tMs);
  const current: [number, number] = [now.x, now.y];

  const past: [number, number][] = [];
  if (now.index >= 0) {
    const startMs = pastSeconds > 0 ? tMs - pastSeconds * 1000 : -Infinity;
    let from = 0;
    if (startMs > track.t[0]) {
      const start = interpolate(track, startMs);
      past.push([start.x, start.y]);
      from = start.index + 1;
    }
    for (let i = from; i <= Math.min(now.index, n - 1); i++) past.push([track.x[i], track.y[i]]);
    past.push(current);
  }

  const future: [number, number][] = [current];
  for (let i = Math.max(0, now.index + 1); i < n; i++) future.push([track.x[i], track.y[i]]);

  return { past, future };
}

/** Linear interpolation between fixes, clamped to the first/last fix. */
function interpolate(track: PreparedTrack, tMs: number) {
  const n = track.t.length;
  const i = indexAt(track.t, tMs);
  if (i < 0) return { ...pointAt(track, 0), index: i };
  if (i >= n - 1) return { ...pointAt(track, n - 1), index: i };
  const span = track.t[i + 1] - track.t[i];
  const f = span > 0 ? (tMs - track.t[i]) / span : 0;
  return {
    x: track.x[i] + (track.x[i + 1] - track.x[i]) * f,
    y: track.y[i] + (track.y[i + 1] - track.y[i]) * f,
    lat: track.lat[i] + (track.lat[i + 1] - track.lat[i]) * f,
    lon: track.lon[i] + (track.lon[i + 1] - track.lon[i]) * f,
    index: i,
  };
}

function pointAt(track: PreparedTrack, i: number) {
  return { x: track.x[i], y: track.y[i], lat: track.lat[i], lon: track.lon[i] };
}
