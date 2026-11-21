/**
 * Esri World Imagery Wayback: archived releases of the Esri satellite layer.
 *
 * Each release only stores the tiles that changed in it; asking a release for
 * an unchanged tile redirects to the release it was last updated in. The
 * `tilemap` endpoint reports that release, which lets us list only the
 * captures that actually differ at a location instead of all ~200 releases.
 */
import { latToWorldY, lonToWorldX } from './geo';

export const WAYBACK_CONFIG_URL =
  'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json';
const WAYBACK_BASE =
  'https://wayback.maptiles.arcgis.com/arcgis/rest/services/World_Imagery';

export interface WaybackRelease {
  /** Release number used in tile URLs. */
  id: number;
  /** Publication date (YYYY-MM-DD). The imagery itself may be older. */
  date: string;
}

/** Tile URL of a release (Esri order: z/y/x). */
export function waybackTileUrl(id: number, z: number, x: number, y: number): string {
  return `${WAYBACK_BASE}/WMTS/1.0.0/default028mm/MapServer/tile/${id}/${z}/${y}/${x}`;
}

function tilemapUrl(id: number, z: number, x: number, y: number): string {
  return `${WAYBACK_BASE}/MapServer/tilemap/${id}/${z}/${y}/${x}/1/1`;
}

/** Parse Esri's release list into releases sorted newest first. */
export function parseWaybackConfig(json: unknown): WaybackRelease[] {
  if (!json || typeof json !== 'object') return [];
  const out: WaybackRelease[] = [];
  for (const [key, value] of Object.entries(json as Record<string, unknown>)) {
    const id = Number(key);
    const title = (value as { itemTitle?: unknown } | null)?.itemTitle;
    const m = typeof title === 'string' ? /(\d{4}-\d{2}-\d{2})/.exec(title) : null;
    if (Number.isInteger(id) && id > 0 && m) out.push({ id, date: m[1] });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
}

/** `tilemap` response: `data[0]` is 1 when a tile exists, `select[0]` the release it comes from. */
export interface TileMapResult {
  data?: number[];
  select?: number[];
}

/**
 * Releases (newest first) whose imagery differs at one tile. Starting from the
 * newest release, each lookup names the release the tile was last changed in;
 * the walk then continues just before that release, so it costs one request
 * per distinct capture rather than one per release.
 */
export async function findLocalVersions(
  releases: WaybackRelease[],
  tilemap: (releaseId: number) => Promise<TileMapResult>,
  maxRequests = 80,
): Promise<WaybackRelease[]> {
  const index = new Map(releases.map((r, i) => [r.id, i]));
  const out: WaybackRelease[] = [];
  let i = 0;
  for (let n = 0; i < releases.length && n < maxRequests; n++) {
    const res = await tilemap(releases[i].id);
    // No tile here in this release (nor, in practice, any older one).
    if (!res.data?.[0]) break;
    const source = res.select?.[0] ?? releases[i].id;
    const j = index.get(source) ?? i;
    out.push(releases[j]);
    i = Math.max(i, j) + 1;
  }
  return out;
}

const FETCH_TIMEOUT_MS = 15_000;

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { mode: 'cors', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** Memoize a promise, forgetting it on failure so a later call can retry. */
function memo<T>(cache: Map<string, Promise<T>>, key: string, make: () => Promise<T>) {
  let p = cache.get(key);
  if (!p) {
    p = make();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

const releaseCache = new Map<string, Promise<WaybackRelease[]>>();
const localCache = new Map<string, Promise<WaybackRelease[]>>();

/** All Wayback releases, newest first (fetched once). */
export function loadWaybackReleases(): Promise<WaybackRelease[]> {
  return memo(releaseCache, 'all', async () => {
    const releases = parseWaybackConfig(await fetchJson(WAYBACK_CONFIG_URL));
    if (releases.length === 0) throw new Error('Wayback: empty release list');
    return releases;
  });
}

/** Zoom at which local changes are detected (close to the default map zoom). */
const PROBE_ZOOM = 18;

/** Distinct captures at a location, newest first (fetched once per tile). */
export function loadLocalVersions(lat: number, lon: number): Promise<WaybackRelease[]> {
  const n = 2 ** PROBE_ZOOM;
  const x = Math.floor(lonToWorldX(lon) * n);
  const y = Math.floor(latToWorldY(lat) * n);
  return memo(localCache, `${x}/${y}`, async () => {
    const releases = await loadWaybackReleases();
    return findLocalVersions(
      releases,
      (id) => fetchJson(tilemapUrl(id, PROBE_ZOOM, x, y)) as Promise<TileMapResult>,
    );
  });
}
