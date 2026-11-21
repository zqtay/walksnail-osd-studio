/**
 * Raster map tiles: providers and an in-memory cache.
 *
 * Tiles are fetched with CORS so drawing them never taints the canvas (the
 * export reads pixels back). A failed or blocked tile simply stays missing; the
 * renderer falls back to a cached lower-zoom parent or the plain background.
 */
import type { OverlaySettings } from '../../state/settings';
import { waybackTileUrl } from './wayback';

export type TileProviderId = 'map' | 'dark' | 'topo' | 'satellite' | 'hybrid';

/** One raster tile source. Layers are cached independently by `id`. */
export interface TileLayer {
  id: string;
  url: (z: number, x: number, y: number) => string;
  /** Deepest zoom the server has data for; deeper views upscale these tiles. */
  maxZoom: number;
  /** Recolor each tile once after download. */
  transform?: 'dark';
}

/** A selectable map style: one or more layers drawn bottom to top. */
export interface TileProvider {
  id: TileProviderId;
  label: string;
  /** Group in the style picker. Satellite styles can show past imagery. */
  category: 'map' | 'satellite';
  layers: TileLayer[];
  /** Required attribution, burned into the overlay. */
  attribution: string;
}

const esri = (service: string): TileLayer['url'] => (z, x, y) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/${z}/${y}/${x}`;
const osmUrl: TileLayer['url'] = (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

const OSM: TileLayer = { id: 'osm', url: osmUrl, maxZoom: 19 };
const OSM_DARK: TileLayer = { id: 'osm-dark', url: osmUrl, maxZoom: 19, transform: 'dark' };
const ESRI_TOPO: TileLayer = { id: 'esri-topo', url: esri('World_Topo_Map'), maxZoom: 19 };
const ESRI_IMAGERY: TileLayer = { id: 'esri-imagery', url: esri('World_Imagery'), maxZoom: 19 };
const ESRI_ROADS: TileLayer = {
  id: 'esri-roads',
  url: esri('Reference/World_Transportation'),
  maxZoom: 19,
};
const ESRI_PLACES: TileLayer = {
  id: 'esri-places',
  url: esri('Reference/World_Boundaries_and_Places'),
  maxZoom: 19,
};

const IMAGERY_CREDIT = 'Esri, Vantor, Earthstar Geographics';
const LABELS_CREDIT = 'HERE, Garmin, © OpenStreetMap contributors';

export const TILE_PROVIDERS: Record<TileProviderId, TileProvider> = {
  map: {
    id: 'map',
    label: 'Street map',
    category: 'map',
    layers: [OSM],
    attribution: '© OpenStreetMap contributors',
  },
  dark: {
    id: 'dark',
    label: 'Dark street map',
    category: 'map',
    layers: [OSM_DARK],
    attribution: '© OpenStreetMap contributors',
  },
  topo: {
    id: 'topo',
    label: 'Topographic',
    category: 'map',
    layers: [ESRI_TOPO],
    attribution: 'Esri, HERE, Garmin, USGS, © OpenStreetMap contributors',
  },
  satellite: {
    id: 'satellite',
    label: 'Satellite',
    category: 'satellite',
    layers: [ESRI_IMAGERY],
    attribution: IMAGERY_CREDIT,
  },
  hybrid: {
    id: 'hybrid',
    label: 'Satellite + labels',
    category: 'satellite',
    layers: [ESRI_IMAGERY, ESRI_ROADS, ESRI_PLACES],
    attribution: `${IMAGERY_CREDIT}, ${LABELS_CREDIT}`,
  },
};

/**
 * The tile style to draw for the given settings, or undefined for none. A
 * satellite style with a past imagery release swaps in that Wayback release.
 */
export function tileProviderFor(
  s: Pick<OverlaySettings, 'mapTiles' | 'mapImagery' | 'mapImageryDate'>,
): TileProvider | undefined {
  if (s.mapTiles === 'none') return undefined;
  const base = TILE_PROVIDERS[s.mapTiles];
  if (base.category !== 'satellite' || !s.mapImagery) return base;
  const release = s.mapImagery;
  const past: TileLayer = {
    id: `wayback-${release}`,
    url: (z, x, y) => waybackTileUrl(release, z, x, y),
    maxZoom: 19,
  };
  const credit = `Esri Wayback ${s.mapImageryDate}`.trim();
  return {
    ...base,
    layers: base.layers.map((l) => (l === ESRI_IMAGERY ? past : l)),
    attribution: base.attribution.replace(IMAGERY_CREDIT, credit),
  };
}

/**
 * Lower zoom levels tried when a tile is missing: a cached ancestor is
 * stretched while it downloads, and when the server has no tile at that zoom
 * (e.g. older imagery releases) the ancestor is fetched instead.
 */
export const PARENT_FALLBACK_LEVELS = 5;

export interface TileKey {
  z: number;
  x: number;
  y: number;
}

/** A tile of a specific layer, e.g. one to prefetch before an export. */
export interface TileRequest extends TileKey {
  layer: TileLayer;
}

/**
 * Recolor a light street-map tile in place into a dark style: invert, rotate
 * hue 180° (so water stays blue and parks green), then compress the range so
 * it isn't harsh. Alpha is untouched.
 */
export function darkenPixels(data: Uint8ClampedArray): void {
  for (let i = 0; i < data.length; i += 4) {
    const r = 255 - data[i];
    const g = 255 - data[i + 1];
    const b = 255 - data[i + 2];
    // CSS hue-rotate(180deg) matrix.
    const r2 = clamp255(-0.574 * r + 1.43 * g + 0.144 * b);
    const g2 = clamp255(0.426 * r + 0.43 * g + 0.144 * b);
    const b2 = clamp255(0.426 * r + 1.43 * g - 0.856 * b);
    // Slightly dimmer and lower contrast.
    data[i] = 0.765 * r2 + 19;
    data[i + 1] = 0.765 * g2 + 19;
    data[i + 2] = 0.765 * b2 + 19;
  }
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

type Entry =
  | { state: 'loading' }
  | { state: 'ready'; image: ImageBitmap }
  | { state: 'error'; at: number };

/** Parallel tile downloads. */
const MAX_CONCURRENT = 6;
/** Wait this long (ms) before retrying a tile that failed. */
const RETRY_AFTER_MS = 30_000;
/** Give up on a single tile download after this long (ms). */
const FETCH_TIMEOUT_MS = 15_000;

/** LRU cache of decoded tiles with a bounded download queue. */
export class TileCache {
  private entries = new Map<string, Entry>();
  private queue: { layer: TileLayer; key: TileKey; id: string }[] = [];
  private active = 0;
  private listeners = new Set<() => void>();
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private waiters = new Map<string, (() => void)[]>();

  constructor(private capacity = 800) {}

  /**
   * Return a decoded tile if cached. When `request` is true a missing tile is
   * queued for download and listeners are notified once it arrives.
   */
  get(layer: TileLayer, z: number, x: number, y: number, request = true) {
    const id = tileId(layer, z, x, y);
    const entry = this.entries.get(id);
    if (entry?.state === 'ready') {
      // Refresh LRU position.
      this.entries.delete(id);
      this.entries.set(id, entry);
      return entry.image;
    }
    if (request) this.request(layer, { z, x, y }, id, entry);
    return undefined;
  }

  /** Whether a tile failed to download (missing on the server, or offline). */
  hasFailed(layer: TileLayer, z: number, x: number, y: number): boolean {
    return this.entries.get(tileId(layer, z, x, y))?.state === 'error';
  }

  /** Notify `fn` (debounced) whenever new tiles become available. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /**
   * Download every tile in `keys` (e.g. before an export) and resolve once all
   * have finished or failed. A tile that fails is replaced by its nearest
   * available ancestor (what the renderer will stretch). Grows the cache so
   * prefetched tiles aren't evicted. `failed` counts tiles with no usable image.
   */
  async prefetch(
    keys: TileRequest[],
    signal?: AbortSignal,
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ loaded: number; failed: number }> {
    this.capacity = Math.max(this.capacity, keys.length + 200);
    let done = 0;
    let failed = 0;
    const aborted = new Promise<never>((_, reject) => {
      if (!signal) return;
      const fail = () => reject(new DOMException('Export cancelled', 'AbortError'));
      if (signal.aborted) fail();
      else signal.addEventListener('abort', fail, { once: true });
    });
    /** Resolve true once the tile is ready, false if it failed. */
    const load = (key: TileRequest, retryFailed: boolean) =>
      new Promise<boolean>((resolve) => {
        const id = tileId(key.layer, key.z, key.x, key.y);
        const finish = () => resolve(this.entries.get(id)?.state === 'ready');
        const entry = this.entries.get(id);
        if (entry?.state === 'ready' || (entry?.state === 'error' && !retryFailed)) {
          return finish();
        }
        const list = this.waiters.get(id) ?? [];
        list.push(finish);
        this.waiters.set(id, list);
        this.request(key.layer, key, id, entry?.state === 'error' ? undefined : entry);
      });
    const loadWithFallback = async (key: TileRequest): Promise<boolean> => {
      // Retry the requested tile's earlier failure; ancestors shared by many
      // tiles are tried once.
      if (await load(key, true)) return true;
      let { z, x, y } = key;
      for (let up = 1; up <= PARENT_FALLBACK_LEVELS && z > 0; up++) {
        z--;
        x = Math.floor(x / 2);
        y = Math.floor(y / 2);
        if (await load({ layer: key.layer, z, x, y }, false)) return true;
      }
      return false;
    };
    const all = Promise.all(
      keys.map(async (key) => {
        if (!(await loadWithFallback(key))) failed++;
        onProgress?.(++done, keys.length);
      }),
    );
    await (signal ? Promise.race([all, aborted]) : all);
    return { loaded: keys.length - failed, failed };
  }

  private request(layer: TileLayer, key: TileKey, id: string, entry: Entry | undefined) {
    if (entry?.state === 'loading') return;
    if (entry?.state === 'error' && Date.now() - entry.at < RETRY_AFTER_MS) return;
    this.entries.set(id, { state: 'loading' });
    this.queue.push({ layer, key: { z: key.z, x: key.x, y: key.y }, id });
    this.pump();
  }

  private pump() {
    while (this.active < MAX_CONCURRENT && this.queue.length > 0) {
      // Newest first: the preview wants what's on screen now.
      const job = this.queue.pop()!;
      this.active++;
      void this.download(job.layer, job.key)
        .then((image) => this.store(job.id, { state: 'ready', image }))
        .catch(() => this.store(job.id, { state: 'error', at: Date.now() }))
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }

  private async download(layer: TileLayer, { z, x, y }: TileKey): Promise<ImageBitmap> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(layer.url(z, x, y), {
        mode: 'cors',
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Tile ${z}/${x}/${y}: HTTP ${res.status}`);
      const image = await createImageBitmap(await res.blob());
      return layer.transform === 'dark' ? recolor(image) : image;
    } finally {
      clearTimeout(timer);
    }
  }

  private store(id: string, entry: Entry) {
    this.entries.delete(id);
    this.entries.set(id, entry);
    this.evict();
    const waiters = this.waiters.get(id);
    if (waiters) {
      this.waiters.delete(id);
      waiters.forEach((w) => w());
    }
    if (entry.state === 'ready') this.scheduleNotify();
  }

  private evict() {
    if (this.entries.size <= this.capacity) return;
    for (const [id, entry] of this.entries) {
      if (this.entries.size <= this.capacity) break;
      if (entry.state === 'loading') continue;
      if (entry.state === 'ready') entry.image.close();
      this.entries.delete(id);
    }
  }

  private scheduleNotify() {
    if (this.notifyTimer !== null) return;
    this.notifyTimer = setTimeout(() => {
      this.notifyTimer = null;
      this.listeners.forEach((fn) => fn());
    }, 50);
  }
}

function tileId(layer: TileLayer, z: number, x: number, y: number): string {
  return `${layer.id}/${z}/${x}/${y}`;
}

/** Apply the dark recolor to a decoded tile (done once, then cached). */
async function recolor(image: ImageBitmap): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return image;
  ctx.drawImage(image, 0, 0);
  image.close();
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  darkenPixels(pixels.data);
  return createImageBitmap(pixels);
}

/** Shared cache used by the preview and the export. */
export const mapTileCache = new TileCache();
