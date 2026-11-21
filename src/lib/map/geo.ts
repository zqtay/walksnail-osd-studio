/**
 * Geographic helpers: Web Mercator projection, great-circle distance and
 * display formatting. "World" coordinates are normalized Web Mercator in
 * [0, 1] on both axes (x grows east, y grows south), so a tile at zoom `z`
 * spans `1 / 2^z` world units.
 */

/** Latitude limit of the Web Mercator projection. */
const MAX_LAT = 85.05112878;

const EARTH_RADIUS_M = 6_371_008.8;

/** Project latitude/longitude (degrees) to normalized world x. */
export function lonToWorldX(lon: number): number {
  return (lon + 180) / 360;
}

/** Project latitude (degrees) to normalized world y. */
export function latToWorldY(lat: number): number {
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  const s = Math.sin((clamped * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

/** Inverse of `latToWorldY`. */
export function worldYToLat(y: number): number {
  const n = Math.PI - 2 * Math.PI * y;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

/** Inverse of `lonToWorldX`. */
export function worldXToLon(x: number): number {
  return x * 360 - 180;
}

/** Great-circle distance in metres between two lat/lon points (degrees). */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

export type DistanceUnits = 'metric' | 'imperial';

const FOOT_M = 0.3048;
const MILE_M = 1609.344;
const MILE_FT = 5280;

/**
 * Format a distance for on-map labels. Metric: `85 m`, `1.24 km`, `12.5 km`.
 * Imperial: `280 ft` below 1000 ft, then `1.24 mi`, `12.5 mi`.
 */
export function formatDistance(meters: number, units: DistanceUnits = 'metric'): string {
  if (!Number.isFinite(meters) || meters < 0) return '—';
  if (units === 'imperial') {
    const feet = meters / FOOT_M;
    if (feet < 1000) return `${Math.round(feet)} ft`;
    const mi = meters / MILE_M;
    return `${mi < 10 ? mi.toFixed(2) : mi.toFixed(1)} mi`;
  }
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(2) : km.toFixed(1)} km`;
}

/** Largest 1, 2 or 5 × 10^n not exceeding `max` (at least 1). */
function roundDown125(max: number): number {
  if (!(max >= 1)) return 1;
  const pow = 10 ** Math.floor(Math.log10(max));
  return ([5, 2, 1].find((k) => k * pow <= max) ?? 1) * pow;
}

/**
 * Longest "round" distance not exceeding `maxMeters`, for a map scale bar,
 * with its label. Metric: meters, then km ("50 m", "2 km"). Imperial: feet,
 * then miles once more than a mile fits ("200 ft", "2 mi").
 */
export function niceScaleLength(
  maxMeters: number,
  units: DistanceUnits = 'metric',
): { meters: number; label: string } {
  if (units === 'imperial') {
    const maxFeet = maxMeters / FOOT_M;
    if (maxFeet > MILE_FT) {
      const miles = roundDown125(maxMeters / MILE_M);
      return { meters: miles * MILE_M, label: `${miles} mi` };
    }
    const feet = roundDown125(maxFeet);
    return { meters: feet * FOOT_M, label: `${feet} ft` };
  }
  const meters = roundDown125(maxMeters);
  return { meters, label: meters >= 1000 ? `${meters / 1000} km` : `${meters} m` };
}

