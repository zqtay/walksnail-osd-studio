import { describe, it, expect } from 'vitest';
import { parseOsd, type OsdData } from '../../src/lib/parsers/osd';
import {
  extractHeadings,
  headingAt,
  resolveHeading,
  type HeadingSeries,
} from '../../src/lib/map/heading';
import { extractGpsTrack } from '../../src/lib/map/gps';
import { prepareTrack, sampleTrack } from '../../src/lib/map/track';
import { haversineM } from '../../src/lib/map/geo';
import { readFixtureArrayBuffer, sampleBasenames } from '../helpers/fixtures';

const COLS = 53;
const ROWS = 20;

/** Synthetic OSD whose frames each draw one glyph sequence at row 1, col 10. */
function osdWith(frames: { t: number; glyphs: number[] }[]): OsdData {
  return {
    header: { magic: 'BTFL', unknown32: 0, cols: COLS, rows: ROWS },
    durationMs: frames[frames.length - 1].t,
    frames: frames.map(({ t, glyphs }) => {
      const g = new Uint16Array(COLS * ROWS).fill(0x20);
      glyphs.forEach((v, i) => (g[COLS + 10 + i] = v));
      return { t, glyphs: g };
    }),
  };
}

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const deg = (rad: number) => (rad * 180) / Math.PI;

describe('extractHeadings (AscentG0245 compass bar)', () => {
  const osd = parseOsd(readFixtureArrayBuffer('AscentG0245.osd'));
  const headings = extractHeadings(osd);
  const heading = headings.compass!;

  it('finds the compass bar but no numerical heading', () => {
    expect(headings.compass).toBeDefined();
    expect(headings.numeric).toBeUndefined();
  });

  it('decodes the compass bar at 22.5° resolution', () => {
    expect(heading.source).toBe('compass');
    expect(heading.resolutionDeg).toBe(22.5);
    // Frame 0 shows `l d l S l d l W l` -> sector 9 -> 202.5°.
    expect(heading.t[0]).toBe(0);
    expect(heading.deg[0]).toBe(202.5);
    for (const d of heading.deg) expect(d % 22.5).toBe(0);
  });

  it('agrees with the GPS course during fast flight', () => {
    const gps = extractGpsTrack(osd)!;
    const pts = gps.points;
    const diffs: number[] = [];
    for (let i = 0, j = 0; i < pts.length; i++) {
      while (j < pts.length && pts[j].t - pts[i].t < 1000) j++;
      if (j >= pts.length) break;
      const a = pts[i];
      const b = pts[j];
      const speed = haversineM(a.lat, a.lon, b.lat, b.lon) / ((b.t - a.t) / 1000);
      if (speed < 6) continue;
      const dy = b.lat - a.lat;
      const dx = (b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180);
      const course = (deg(Math.atan2(dx, dy)) + 360) % 360;
      const compass = deg(headingAt(heading, a.t));
      diffs.push(Math.abs(((compass - course + 540) % 360) - 180));
    }
    diffs.sort((x, y) => x - y);
    expect(diffs.length).toBeGreaterThan(100);
    expect(diffs[diffs.length >> 1]).toBeLessThan(22.5);
  });

  it('is attached to the GPS track and drives the drone arrow', () => {
    const gps = extractGpsTrack(osd)!;
    expect(gps.headings.compass).toBeDefined();
    const prepared = prepareTrack(gps, 0);
    const compass = resolveHeading(gps.headings, 'compass');
    expect(deg(sampleTrack(prepared, 0, compass).heading!)).toBeCloseTo(202.5, 6);
    // Trail inference: stationary at t=0, so no heading.
    expect(sampleTrack(prepared, 0, resolveHeading(gps.headings, 'trail')).heading).toBeUndefined();
  });
});

describe.each(sampleBasenames)('extractHeadings (%s)', (basename) => {
  it('finds nothing without a heading element', () => {
    const osd = parseOsd(readFixtureArrayBuffer(`${basename}.osd`));
    expect(extractHeadings(osd)).toEqual({ numeric: undefined, compass: undefined });
  });
});

describe('extractHeadings (synthetic numerical heading)', () => {
  const frames = (glyphs: number[]) =>
    Array.from({ length: 12 }, (_, i) => ({ t: i * 150, glyphs }));

  it('reads arrow + 3 digits when the arrow matches the value', () => {
    // 247° falls in sector 11; Betaflight draws arrow 0x60 + (16 - 11 + 8) % 16.
    const series = extractHeadings(osdWith(frames([0x6d, ...ascii('247')]))).numeric!;
    expect(series.source).toBe('numeric');
    expect(series.deg[0]).toBe(247);
  });

  it('decodes both elements when both are shown', () => {
    const glyphs = [0x68, ...ascii('005'), 0x20, 0x1b, 0x1d, 0x1c, 0x1d, 0x18, 0x1d, 0x1c, 0x1d, 0x1a];
    const headings = extractHeadings(osdWith(frames(glyphs)));
    expect(headings.numeric!.deg[0]).toBe(5);
    expect(headings.compass!.deg[0]).toBe(0);
  });

  it('ignores arrow + digits that disagree (another element)', () => {
    expect(extractHeadings(osdWith(frames([0x60, ...ascii('247')]))).numeric).toBeUndefined();
  });
});

describe('resolveHeading', () => {
  const series = (source: HeadingSeries['source']): HeadingSeries => ({
    t: Float64Array.from([0]),
    deg: Float64Array.from([0]),
    source,
    resolutionDeg: 1,
  });
  const numeric = series('numeric');
  const compass = series('compass');

  it('returns the chosen source when present', () => {
    expect(resolveHeading({ numeric, compass }, 'numeric')).toBe(numeric);
    expect(resolveHeading({ numeric, compass }, 'compass')).toBe(compass);
  });

  it('infers from the trail when asked, or when nothing is available', () => {
    expect(resolveHeading({ numeric, compass }, 'trail')).toBeUndefined();
    expect(resolveHeading({}, 'numeric')).toBeUndefined();
  });

  it('falls back to the other OSD source when the choice is missing', () => {
    expect(resolveHeading({ compass }, 'numeric')).toBe(compass);
    expect(resolveHeading({ numeric }, 'compass')).toBe(numeric);
  });
});

describe('headingAt', () => {
  const series: HeadingSeries = {
    t: Float64Array.from([0, 1000, 1150, 5000]),
    deg: Float64Array.from([350, 350, 10, 90]),
    source: 'compass',
    resolutionDeg: 22.5,
  };

  it('holds within a run and clamps outside the range', () => {
    expect(deg(headingAt(series, -50))).toBeCloseTo(350, 6);
    expect(deg(headingAt(series, 500))).toBeCloseTo(350, 6);
    expect(deg(headingAt(series, 9000))).toBeCloseTo(90, 6);
  });

  it('turns the short way across north', () => {
    expect(deg(headingAt(series, 1075))).toBeCloseTo(360, 6);
  });

  it('holds instead of interpolating across a long gap', () => {
    expect(deg(headingAt(series, 3000))).toBeCloseTo(10, 6);
  });
});
