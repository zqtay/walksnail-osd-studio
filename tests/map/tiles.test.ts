import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TILE_PROVIDERS,
  TileCache,
  darkenPixels,
  tileProviderFor,
  type TileLayer,
} from '../../src/lib/map/tiles';

describe('tile providers', () => {
  it('builds tile URLs in each server\'s axis order', () => {
    expect(TILE_PROVIDERS.map.layers[0].url(5, 10, 20)).toBe(
      'https://tile.openstreetmap.org/5/10/20.png',
    );
    // Esri services take z/y/x.
    expect(TILE_PROVIDERS.topo.layers[0].url(5, 10, 20)).toBe(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/5/20/10',
    );
  });

  it('only uses hosts allowed by the CSP and service worker cache', () => {
    const past = (['satellite', 'hybrid'] as const).map((mapTiles) =>
      tileProviderFor({ mapTiles, mapImagery: 4756, mapImageryDate: '2019-12-12' })!,
    );
    for (const p of [...Object.values(TILE_PROVIDERS), ...past]) {
      expect(p.attribution.length).toBeGreaterThan(0);
      for (const layer of p.layers) {
        expect(layer.url(1, 0, 0)).toMatch(
          /^https:\/\/(tile\.openstreetmap\.org|server\.arcgisonline\.com|wayback\.maptiles\.arcgis\.com)\//,
        );
      }
    }
  });

  it('groups styles into map and satellite', () => {
    const by = (c: string) =>
      Object.values(TILE_PROVIDERS)
        .filter((p) => p.category === c)
        .map((p) => p.id);
    expect(by('map')).toEqual(['map', 'dark', 'topo']);
    expect(by('satellite')).toEqual(['satellite', 'hybrid']);
  });

  it('swaps in past imagery for satellite styles only', () => {
    const s = { mapImagery: 4756, mapImageryDate: '2019-12-12' };
    const hybrid = tileProviderFor({ ...s, mapTiles: 'hybrid' })!;
    expect(hybrid.layers.map((l) => l.id)).toEqual(['wayback-4756', 'esri-roads', 'esri-places']);
    expect(hybrid.layers[0].url(19, 413412, 260237)).toContain('/tile/4756/19/260237/413412');
    expect(hybrid.attribution).toMatch(/^Esri Wayback 2019-12-12, HERE/);
    expect(tileProviderFor({ ...s, mapTiles: 'topo' })).toBe(TILE_PROVIDERS.topo);
    expect(tileProviderFor({ ...s, mapTiles: 'satellite', mapImagery: 0 })).toBe(
      TILE_PROVIDERS.satellite,
    );
    expect(tileProviderFor({ ...s, mapTiles: 'none' })).toBeUndefined();
  });

  it('shares cached imagery between satellite and hybrid', () => {
    expect(TILE_PROVIDERS.hybrid.layers[0]).toBe(TILE_PROVIDERS.satellite.layers[0]);
  });

  it('caches the dark style separately from the street map', () => {
    expect(TILE_PROVIDERS.dark.layers[0].id).not.toBe(TILE_PROVIDERS.map.layers[0].id);
  });
});

describe('darkenPixels', () => {
  const px = (r: number, g: number, b: number, a = 255) => {
    const d = new Uint8ClampedArray([r, g, b, a]);
    darkenPixels(d);
    return [...d];
  };

  it('turns light land dark and keeps alpha', () => {
    const [r, g, b, a] = px(242, 239, 233, 128); // OSM land color
    expect(Math.max(r, g, b)).toBeLessThan(60);
    expect(a).toBe(128);
  });

  it('keeps water blue and parks green', () => {
    const [wr, , wb] = px(170, 211, 223); // OSM water
    expect(wb).toBeGreaterThan(wr);
    const [pr, pg, pb] = px(200, 250, 204); // OSM park
    expect(pg).toBeGreaterThan(pr);
    expect(pg).toBeGreaterThan(pb);
  });

  it('turns dark text light', () => {
    const [r, g, b] = px(40, 40, 40);
    expect(Math.min(r, g, b)).toBeGreaterThan(150);
  });
});

describe('TileCache.prefetch', () => {
  afterEach(() => vi.unstubAllGlobals());

  // Server with imagery only down to zoom 17, like older Wayback releases.
  const layer: TileLayer = { id: 'test', url: (z, x, y) => `${z}/${x}/${y}`, maxZoom: 19 };
  const stubServer = (maxZoom: number) => {
    const requested: string[] = [];
    vi.stubGlobal('fetch', async (url: string) => {
      requested.push(url);
      const z = Number(url.split('/')[0]);
      return { ok: z <= maxZoom, status: z <= maxZoom ? 200 : 404, blob: async () => ({}) };
    });
    vi.stubGlobal('createImageBitmap', async () => ({ width: 256, height: 256, close() {} }));
    return requested;
  };

  it('falls back to the nearest available ancestor for missing zooms', async () => {
    const requested = stubServer(17);
    const cache = new TileCache();
    // Four z19 siblings share one z18 parent and one z17 grandparent.
    const keys = [0, 1].flatMap((dx) =>
      [0, 1].map((dy) => ({ layer, z: 19, x: 400 + dx, y: 800 + dy })),
    );
    const result = await cache.prefetch(keys);
    expect(result).toEqual({ loaded: 4, failed: 0 });
    expect(cache.get(layer, 17, 100, 200, false)).toBeDefined();
    // Each shared ancestor is downloaded once.
    expect(requested.filter((u) => u === '18/200/400')).toHaveLength(1);
    expect(requested.filter((u) => u === '17/100/200')).toHaveLength(1);
  });

  it('reports tiles with no usable ancestor as failed', async () => {
    stubServer(-1);
    const result = await new TileCache().prefetch([{ layer, z: 10, x: 1, y: 1 }]);
    expect(result).toEqual({ loaded: 0, failed: 1 });
  });
});

