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
    expect(new Set(keys.map((k) => `${k.z}/${k.x}/${k.y}`)).size).toBe(keys.length);
    expect(
      collectMapTiles(gps, { ...settings, mapTiles: 'none' }, 0, 1000, 1920, 1080),
    ).toEqual([]);
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
