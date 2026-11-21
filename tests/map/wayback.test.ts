import { describe, expect, it } from 'vitest';
import {
  findLocalVersions,
  parseWaybackConfig,
  waybackTileUrl,
  type TileMapResult,
} from '../../src/lib/map/wayback';

const item = (date: string) => ({ itemTitle: `World Imagery (Wayback ${date})` });

describe('parseWaybackConfig', () => {
  it('sorts releases newest first and skips malformed entries', () => {
    const releases = parseWaybackConfig({
      '10': item('2014-02-20'),
      '3692': item('2026-11-18'),
      '4756': item('2019-12-12'),
      abc: item('2020-01-01'),
      '99': { itemTitle: 'no date' },
      '98': null,
    });
    expect(releases).toEqual([
      { id: 3692, date: '2026-11-18' },
      { id: 4756, date: '2019-12-12' },
      { id: 10, date: '2014-02-20' },
    ]);
  });

  it('returns nothing for non-objects', () => {
    expect(parseWaybackConfig(null)).toEqual([]);
    expect(parseWaybackConfig('x')).toEqual([]);
  });
});

describe('waybackTileUrl', () => {
  it('uses Esri z/y/x order with the release number', () => {
    expect(waybackTileUrl(4756, 19, 413412, 260237)).toBe(
      'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/WMTS/1.0.0/default028mm/MapServer/tile/4756/19/260237/413412',
    );
  });
});

describe('findLocalVersions', () => {
  // Newest first. The tile changed in releases 50, 30 and 10.
  const releases = [60, 50, 40, 30, 20, 10].map((id) => ({ id, date: `20${id}-01-01` }));
  const changedIn = (id: number) => (id >= 50 ? 50 : id >= 30 ? 30 : 10);

  it('lists one release per distinct capture with one request each', async () => {
    const asked: number[] = [];
    const versions = await findLocalVersions(releases, async (id) => {
      asked.push(id);
      return { data: [1], select: [changedIn(id)] };
    });
    expect(versions.map((v) => v.id)).toEqual([50, 30, 10]);
    expect(asked).toEqual([60, 40, 20]);
  });

  it('treats a missing select as the release itself', async () => {
    const versions = await findLocalVersions(releases.slice(0, 2), async () => ({ data: [1] }));
    expect(versions.map((v) => v.id)).toEqual([60, 50]);
  });

  it('stops where the area has no imagery', async () => {
    const versions = await findLocalVersions(releases, async (id): Promise<TileMapResult> =>
      id >= 50 ? { data: [1], select: [changedIn(id)] } : { data: [0] },
    );
    expect(versions.map((v) => v.id)).toEqual([50]);
  });

  it('always makes progress and respects the request cap', async () => {
    // A bogus select pointing at a newer release must not loop forever.
    let calls = 0;
    const versions = await findLocalVersions(
      releases,
      async () => {
        calls++;
        return { data: [1], select: [60] };
      },
      4,
    );
    expect(calls).toBe(4);
    expect(versions).toHaveLength(4);
  });
});
