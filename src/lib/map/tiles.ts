/**
 * Raster map tiles: providers and an in-memory cache.
 *
 * Tiles are fetched with CORS so drawing them never taints the canvas (the
 * export reads pixels back). A failed or blocked tile simply stays missing; the
 * renderer falls back to a cached lower-zoom parent or the plain background.
 */

export type TileProviderId = 'map' | 'satellite';

export interface TileProvider {
  id: TileProviderId;
  label: string;
  url: (z: number, x: number, y: number) => string;
  maxZoom: number;
  /** Required attribution, burned into the overlay. */
  attribution: string;
}

export const TILE_PROVIDERS: Record<TileProviderId, TileProvider> = {
  map: {
    id: 'map',
    label: 'Street map',
    url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
    maxZoom: 19,
    attribution: '© OpenStreetMap contributors',
  },
  satellite: {
    id: 'satellite',
    label: 'Satellite',
    url: (z, x, y) =>
      `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    maxZoom: 19,
    attribution: 'Esri, Maxar, Earthstar Geographics',
  },
};

export interface TileKey {
  z: number;
  x: number;
  y: number;
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
  private queue: { provider: TileProvider; key: TileKey; id: string }[] = [];
  private active = 0;
  private listeners = new Set<() => void>();
  private notifyTimer: ReturnType<typeof setTimeout> | null = null;
  private waiters = new Map<string, (() => void)[]>();

  constructor(private capacity = 800) {}

  /**
   * Return a decoded tile if cached. When `request` is true a missing tile is
   * queued for download and listeners are notified once it arrives.
   */
  get(provider: TileProvider, z: number, x: number, y: number, request = true) {
    const id = tileId(provider, z, x, y);
    const entry = this.entries.get(id);
    if (entry?.state === 'ready') {
      // Refresh LRU position.
      this.entries.delete(id);
      this.entries.set(id, entry);
      return entry.image;
    }
    if (request) this.request(provider, { z, x, y }, id, entry);
    return undefined;
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
   * have finished or failed. Grows the cache so prefetched tiles aren't evicted.
   */
  async prefetch(
    provider: TileProvider,
    keys: TileKey[],
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
    const all = Promise.all(
      keys.map(
        (key) =>
          new Promise<void>((resolve) => {
            const id = tileId(provider, key.z, key.x, key.y);
            const finish = () => {
              const e = this.entries.get(id);
              if (e?.state !== 'ready') failed++;
              onProgress?.(++done, keys.length);
              resolve();
            };
            const entry = this.entries.get(id);
            if (entry?.state === 'ready') return finish();
            const list = this.waiters.get(id) ?? [];
            list.push(finish);
            this.waiters.set(id, list);
            // Retry previous failures immediately when explicitly prefetching.
            this.request(provider, key, id, entry?.state === 'error' ? undefined : entry);
          }),
      ),
    );
    await (signal ? Promise.race([all, aborted]) : all);
    return { loaded: keys.length - failed, failed };
  }

  private request(provider: TileProvider, key: TileKey, id: string, entry: Entry | undefined) {
    if (entry?.state === 'loading') return;
    if (entry?.state === 'error' && Date.now() - entry.at < RETRY_AFTER_MS) return;
    this.entries.set(id, { state: 'loading' });
    this.queue.push({ provider, key, id });
    this.pump();
  }

  private pump() {
    while (this.active < MAX_CONCURRENT && this.queue.length > 0) {
      // Newest first: the preview wants what's on screen now.
      const job = this.queue.pop()!;
      this.active++;
      void this.download(job.provider, job.key)
        .then((image) => this.store(job.id, { state: 'ready', image }))
        .catch(() => this.store(job.id, { state: 'error', at: Date.now() }))
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }

  private async download(provider: TileProvider, { z, x, y }: TileKey): Promise<ImageBitmap> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(provider.url(z, x, y), {
        mode: 'cors',
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Tile ${z}/${x}/${y}: HTTP ${res.status}`);
      return await createImageBitmap(await res.blob());
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

function tileId(provider: TileProvider, z: number, x: number, y: number): string {
  return `${provider.id}/${z}/${x}/${y}`;
}

/** Shared cache used by the preview and the export. */
export const mapTileCache = new TileCache();
