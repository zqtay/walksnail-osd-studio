import { describe, it, expect } from 'vitest';
import {
  prepareTrack,
  sampleTrack,
  smoothPoints,
  trailPolylines,
} from '../../src/lib/map/track';
import type { GpsPoint, GpsTrack } from '../../src/lib/map/gps';
import { formatDistance, haversineM, latToWorldY, worldYToLat } from '../../src/lib/map/geo';

/** Straight northward flight with alternating east/west jitter. */
function jittery(n: number): GpsPoint[] {
  return Array.from({ length: n }, (_, i) => ({
    t: i * 150,
    lat: 1.3 + i * 0.00001,
    lon: 103.8 + (i % 2 === 0 ? 0.00002 : -0.00002),
  }));
}

describe('geo', () => {
  it('round-trips latitude through Web Mercator', () => {
    for (const lat of [-60, -1.3, 0, 1.3088943, 45, 70]) {
      expect(worldYToLat(latToWorldY(lat))).toBeCloseTo(lat, 9);
    }
  });

  it('measures distance', () => {
    // One degree of latitude is ~111.2 km.
    expect(haversineM(0, 0, 1, 0)).toBeCloseTo(111_195, -2);
  });

  it('formats distances', () => {
    expect(formatDistance(85.4)).toBe('85 m');
    expect(formatDistance(1240)).toBe('1.24 km');
    expect(formatDistance(12_500)).toBe('12.5 km');
  });
});

describe('smoothPoints', () => {
  it('is the identity at 0%', () => {
    const pts = jittery(20);
    expect(smoothPoints(pts, 0)).toBe(pts);
  });

  it('reduces jitter while keeping endpoints and times', () => {
    const pts = jittery(40);
    const out = smoothPoints(pts, 50);
    expect(out[0]).toEqual(pts[0]);
    expect(out[out.length - 1]).toEqual(pts[pts.length - 1]);
    expect(out.map((p) => p.t)).toEqual(pts.map((p) => p.t));
    for (const p of out.slice(10, 30)) {
      expect(Math.abs(p.lon - 103.8)).toBeLessThan(0.000005);
    }
  });
});

describe('sampleTrack', () => {
  const track: GpsTrack = {
    points: [
      { t: 0, lat: 1.3, lon: 103.8 },
      { t: 1000, lat: 1.3001, lon: 103.8 },
      { t: 2000, lat: 1.3001, lon: 103.8001 },
    ],
    home: { lat: 1.3, lon: 103.8 },
    source: 'test',
    headings: {},
  };
  const prepared = prepareTrack(track, 0);

  it('interpolates between fixes', () => {
    const s = sampleTrack(prepared, 500);
    expect(s.index).toBe(0);
    expect(s.lat).toBeCloseTo(1.30005, 9);
    expect(s.lon).toBeCloseTo(103.8, 9);
  });

  it('clamps before the first and after the last fix', () => {
    expect(sampleTrack(prepared, -100)).toMatchObject({ lat: 1.3, index: -1 });
    expect(sampleTrack(prepared, 9999)).toMatchObject({ lon: 103.8001, index: 2 });
  });

  it('derives heading from movement (north, then east)', () => {
    expect(sampleTrack(prepared, 900).heading).toBeCloseTo(0, 3);
    expect(sampleTrack(prepared, 1900).heading).toBeCloseTo(Math.PI / 2, 1);
    expect(sampleTrack(prepared, 0).heading).toBeUndefined();
  });

  it('includes home in the bounds', () => {
    expect(prepared.home).toBeDefined();
    expect(prepared.bounds.maxY).toBeCloseTo(prepared.home!.y, 12);
  });
});

describe('trailPolylines', () => {
  // Four fixes one second apart, moving north.
  const track = prepareTrack(
    {
      points: [0, 1, 2, 3].map((i) => ({ t: i * 1000, lat: 1.3 + i * 0.0001, lon: 103.8 })),
      source: 'test',
      headings: {},
    },
    0,
  );
  const at = (i: number): [number, number] => [track.x[i], track.y[i]];
  const mid = (a: number, b: number, f: number): [number, number] => [
    track.x[a] + (track.x[b] - track.x[a]) * f,
    track.y[a] + (track.y[b] - track.y[a]) * f,
  ];
  const expectPoints = (actual: [number, number][], expected: [number, number][]) => {
    expect(actual).toHaveLength(expected.length);
    actual.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(expected[i][0], 12);
      expect(p[1]).toBeCloseTo(expected[i][1], 12);
    });
  };

  it('keeps the whole flown trail when unlimited', () => {
    const { past, future } = trailPolylines(track, 2500, 0);
    expectPoints(past, [at(0), at(1), at(2), mid(2, 3, 0.5)]);
    expectPoints(future, [mid(2, 3, 0.5), at(3)]);
  });

  it('starts the flown trail exactly N seconds back', () => {
    const { past, future } = trailPolylines(track, 2500, 1.2);
    expectPoints(past, [mid(1, 2, 0.3), at(2), mid(2, 3, 0.5)]);
    // The upcoming part is unaffected by the limit.
    expectPoints(future, [mid(2, 3, 0.5), at(3)]);
  });

  it('shows everything flown so far when the limit exceeds it', () => {
    expectPoints(trailPolylines(track, 1500, 60).past, [at(0), at(1), mid(1, 2, 0.5)]);
  });

  it('has no flown trail before the first fix', () => {
    const { past, future } = trailPolylines(track, -500, 0);
    expect(past).toEqual([]);
    expectPoints(future, [at(0), at(0), at(1), at(2), at(3)]);
  });
});
