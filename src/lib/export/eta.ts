/**
 * Remaining-time estimate for an export, from the average rate so far. Steady
 * (no jitter from per-frame speed changes) and self-correcting as it runs.
 */

/** Don't estimate before this much work and time, when the rate is noise. */
const MIN_FRACTION = 0.02;
const MIN_ELAPSED_MS = 1500;

/** Estimated milliseconds left, or undefined while it's too early to tell. */
export function estimateRemainingMs(fraction: number, elapsedMs: number): number | undefined {
  if (!(fraction >= MIN_FRACTION) || !(elapsedMs >= MIN_ELAPSED_MS)) return undefined;
  if (fraction >= 1) return 0;
  return (elapsedMs * (1 - fraction)) / fraction;
}

/** Short duration label: `8 s`, `1 min 05 s`, `1 h 02 min`. */
export function formatRemaining(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`;
  const m = Math.round(s / 60);
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
