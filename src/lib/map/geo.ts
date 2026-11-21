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

/** Format a distance for on-map labels: `85 m`, `1.24 km`, `12.5 km`. */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return `${km < 10 ? km.toFixed(2) : km.toFixed(1)} km`;
}
