import { describe, it, expect } from 'vitest';
import {
  computeMapRect,
  computeMapView,
  layoutTiles,
  projectToEdge,
  worldToScreen,
  type MapLayoutSettings,
} from '../../src/lib/map/view';
import { prepareTrack, sampleTrack } from '../../src/lib/map/track';
import { parseOsd } from '../../src/lib/parsers/osd';
import { extractGpsTrack } from '../../src/lib/map/gps';
import { collectMapTiles } from '../../src/lib/map/map-renderer';
import { DEFAULT_SETTINGS } from '../../src/state/settings';
import { readFixtureArrayBuffer } from '../helpers/fixtures';

const base: MapLayoutSettings = {
  mapX: 0.8,
  mapY: 0.6,
  mapSize: 0.3,
  mapAspect: 1.5,
  mapShape: 'rect',
  mapMode: 'follow',
  mapZoom: 17,
  mapAdaptiveZoom: false,
};

describe('computeMapRect', () => {
  it('sizes relative to the output height and clamps on-screen', () => {
    const r = computeMapRect(base, 1920, 1080);
    expect(r.h).toBeCloseTo(324, 6);
    expect(r.w).toBeCloseTo(486, 6);
    expect(r.x + r.w).toBeLessThanOrEqual(1920);
    expect(r.y + r.h).toBeLessThanOrEqual(1080);
  });

  it('forces a square for circles', () => {
    const r = computeMapRect({ ...base, mapShape: 'circle' }, 1920, 1080);
    expect(r.w).toBe(r.h);
  });

  it('scales with the export resolution', () => {
    const a = computeMapRect(base, 1920, 1080);
    const b = computeMapRect(base, 3840, 2160);
    expect(b.x).toBeCloseTo(a.x * 2, 6);
    expect(b.h).toBeCloseTo(a.h * 2, 6);
  });
});

describe('computeMapView', () => {
  const osd = parseOsd(readFixtureArrayBuffer('AscentG0245.osd'));
  const gps = extractGpsTrack(osd)!;
  const prepared = prepareTrack(gps, 30);
  const rect = computeMapRect(base, 1920, 1080);

  it('centers the drone in follow mode', () => {
    const drone = sampleTrack(prepared, 60_000);
    const view = computeMapView(prepared, drone, base, rect);
    const [x, y] = worldToScreen(view, drone.x, drone.y);
    expect(x).toBeCloseTo(rect.x + rect.w / 2, 6);
    expect(y).toBeCloseTo(rect.y + rect.h / 2, 6);
  });

  it('fits the whole trail and home inside the rect in overview mode', () => {
    const s = { ...base, mapMode: 'overview' as const };
    const view = computeMapView(prepared, sampleTrack(prepared, 0), s, rect);
    for (let i = 0; i < prepared.x.length; i++) {
      const [x, y] = worldToScreen(view, prepared.x[i], prepared.y[i]);
      expect(x).toBeGreaterThanOrEqual(rect.x);
      expect(x).toBeLessThanOrEqual(rect.x + rect.w);
      expect(y).toBeGreaterThanOrEqual(rect.y);
      expect(y).toBeLessThanOrEqual(rect.y + rect.h);
    }
  });

  it('lays out seamless tiles covering the rect', () => {
    const view = computeMapView(prepared, sampleTrack(prepared, 60_000), base, rect);
    const tiles = layoutTiles(view, 19);
    expect(tiles.length).toBeGreaterThan(0);
    expect(Math.min(...tiles.map((t) => t.dx))).toBeLessThanOrEqual(rect.x + 1);
    expect(Math.max(...tiles.map((t) => t.dx + t.dw))).toBeGreaterThanOrEqual(rect.x + rect.w - 1);
    expect(Math.min(...tiles.map((t) => t.dy))).toBeLessThanOrEqual(rect.y + 1);
    expect(Math.max(...tiles.map((t) => t.dy + t.dh))).toBeGreaterThanOrEqual(rect.y + rect.h - 1);
    // Horizontal neighbours share edges exactly.
    for (const a of tiles) {
      const right = tiles.find((b) => b.y === a.y && b.dx === a.dx + a.dw);
      if (right) expect(right.dy).toBe(a.dy);
    }
  });

  it('collects unique export tiles for the trim range', () => {
    const settings = { ...DEFAULT_SETTINGS, mapTiles: 'map' as const };
    const keys = collectMapTiles(gps, settings, 0, osd.durationMs, 1920, 1080);
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys.map((k) => `${k.layer.id}/${k.z}/${k.x}/${k.y}`)).size).toBe(
      keys.length,
    );
    expect(
      collectMapTiles(gps, { ...settings, mapTiles: 'none' }, 0, 1000, 1920, 1080),
    ).toEqual([]);
  });

  it('collects every layer of a multi-layer style', () => {
    const base = collectMapTiles(
      gps,
      { ...DEFAULT_SETTINGS, mapTiles: 'satellite' },
      0,
      osd.durationMs,
      1920,
      1080,
    );
    const hybrid = collectMapTiles(
      gps,
      { ...DEFAULT_SETTINGS, mapTiles: 'hybrid' },
      0,
      osd.durationMs,
      1920,
      1080,
    );
    expect(hybrid.length).toBe(base.length * 3);
    expect(new Set(hybrid.map((k) => k.layer.id))).toEqual(
      new Set(['esri-imagery', 'esri-roads', 'esri-places']),
    );
  });
});

describe('projectToEdge', () => {
  const rect = { x: 0, y: 0, w: 200, h: 100 };

  it('leaves inside points alone', () => {
    expect(projectToEdge('rect', rect, 10, 120, 60)).toEqual({ x: 120, y: 60, inside: true });
  });

  it('pins outside points to the inset rect edge along the center ray', () => {
    const p = projectToEdge('rect', rect, 10, 1100, 50);
    expect(p.inside).toBe(false);
    expect(p.x).toBeCloseTo(190, 6);
    expect(p.y).toBeCloseTo(50, 6);
    expect(projectToEdge('rect', rect, 10, 100, -500).y).toBeCloseTo(10, 6);
  });

  it('pins to the inset circle', () => {
    const sq = { x: 0, y: 0, w: 100, h: 100 };
    const p = projectToEdge('circle', sq, 10, 350, 450);
    expect(p.inside).toBe(false);
    expect(Math.hypot(p.x - 50, p.y - 50)).toBeCloseTo(40, 6);
  });
});

describe('adaptive zoom', () => {
  const osd = parseOsd(readFixtureArrayBuffer('AscentG0245.osd'));
  const gps = extractGpsTrack(osd)!;
  const prepared = prepareTrack(gps, 10);
  const home = prepared.home!;
  const MARGIN = 0.07; // ADAPTIVE_MARGIN in view.ts
  const times = Array.from({ length: 300 }, (_, i) => (i / 299) * osd.durationMs);

  /** Is a world point inside the rect inset by the adaptive margin? */
  const insideInset = (
    view: ReturnType<typeof computeMapView>,
    shape: 'rect' | 'circle',
    wx: number,
    wy: number,
  ) => {
    const { rect } = view;
    const m = rect.h * MARGIN - 1e-6;
    const [x, y] = worldToScreen(view, wx, wy);
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    if (shape === 'circle') return Math.hypot(x - cx, y - cy) <= rect.h / 2 - m;
    return Math.abs(x - cx) <= rect.w / 2 - m && Math.abs(y - cy) <= rect.h / 2 - m;
  };

  describe.each([
    ['follow', 'rect'],
    ['follow', 'circle'],
    ['overview', 'rect'],
    ['overview', 'circle'],
  ] as const)('%s / %s', (mode, shape) => {
    // Max zoom 20 forces the adaptive fit to kick in for most of the flight.
    const s: MapLayoutSettings = {
      ...base,
      mapMode: mode,
      mapShape: shape,
      mapZoom: 20,
      mapAdaptiveZoom: true,
    };
    const rect = computeMapRect(s, 1920, 1080);

    it('keeps the drone and home point in view without exceeding max zoom', () => {
      for (const t of times) {
        const drone = sampleTrack(prepared, t);
        const view = computeMapView(prepared, drone, s, rect);
        expect(view.zoom).toBeLessThanOrEqual(20);
        expect(insideInset(view, shape, home.x, home.y)).toBe(true);
        expect(insideInset(view, shape, drone.x, drone.y)).toBe(true);
      }
    });

    it('zooms smoothly (no level steps)', () => {
      let fractional = 0;
      for (const t of times) {
        const a = computeMapView(prepared, sampleTrack(prepared, t), s, rect).zoom;
        const b = computeMapView(prepared, sampleTrack(prepared, t + 20), s, rect).zoom;
        expect(Math.abs(b - a)).toBeLessThan(0.05);
        if (Math.abs(a - Math.round(a)) > 0.01) fractional++;
      }
      expect(fractional).toBeGreaterThan(times.length / 2);
    });
  });

  it('uses the max zoom while home is already in view (follow)', () => {
    const s: MapLayoutSettings = { ...base, mapZoom: 15, mapAdaptiveZoom: true };
    const rect = computeMapRect(s, 1920, 1080);
    const view = computeMapView(prepared, sampleTrack(prepared, 60_000), s, rect);
    expect(view.zoom).toBe(15);
  });

  it('samples the moving whole-trail view when prefetching export tiles', () => {
    const settings = { ...DEFAULT_SETTINGS, mapMode: 'overview' as const, mapZoom: 20 };
    const fixed = collectMapTiles(gps, settings, 0, osd.durationMs, 1920, 1080);
    const adaptive = collectMapTiles(
      gps,
      { ...settings, mapAdaptiveZoom: true },
      0,
      osd.durationMs,
      1920,
      1080,
    );
    expect(adaptive.length).toBeGreaterThan(fixed.length);
  });
});
