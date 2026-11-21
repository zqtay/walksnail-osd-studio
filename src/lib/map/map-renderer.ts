import type { OverlaySettings } from '../../state/settings';
import type { GpsTrack } from './gps';
import { formatDistance, haversineM } from './geo';
import {
  PARENT_FALLBACK_LEVELS,
  tileProviderFor,
  type TileCache,
  type TileLayer,
  type TileRequest,
} from './tiles';
import { getPreparedTrack, sampleTrack, trailPolylines, type PreparedTrack } from './track';
import { resolveHeading } from './heading';
import {
  computeMapRect,
  computeMapView,
  layoutTiles,
  projectToEdge,
  worldToScreen,
  type MapRect,
  type MapView,
} from './view';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Map settings consumed by the renderer. */
export type MapRenderSettings = Pick<
  OverlaySettings,
  | 'mapTiles'
  | 'mapImagery'
  | 'mapImageryDate'
  | 'mapMode'
  | 'mapShape'
  | 'mapX'
  | 'mapY'
  | 'mapSize'
  | 'mapAspect'
  | 'mapZoom'
  | 'mapSmoothing'
  | 'mapOpacity'
  | 'mapShowHome'
  | 'mapShowHomeDistance'
  | 'mapFutureTrail'
  | 'mapTrailColor'
  | 'mapHeading'
  | 'mapTrailSeconds'
  | 'mapAdaptiveZoom'
>;

/** Interval (ms) at which a moving view is sampled when prefetching. */
const PREFETCH_STEP_MS = 250;
/**
 * Extra coverage (fraction per side) when prefetching, so tiles that scroll in
 * between two sampled views are already downloaded.
 */
const PREFETCH_PAD = 0.1;

const HOME_FILL = '#2f80ed';
/** Home marker radius, in UI units. */
const HOME_R = 8;
const MAP_BG = '#1d232a';

const providerFor = tileProviderFor;

/**
 * Draw the GPS map overlay for time `tMs` (on the OSD timeline). Deterministic
 * given the same cached tiles, so preview and export match.
 */
export function renderMap(
  ctx: Ctx2D,
  track: GpsTrack,
  tiles: TileCache | undefined,
  s: MapRenderSettings,
  tMs: number,
  W: number,
  H: number,
): void {
  const prepared = getPreparedTrack(track, s.mapSmoothing);
  if (prepared.t.length === 0) return;
  const rect = computeMapRect(s, W, H);
  if (rect.w < 4 || rect.h < 4) return;
  const drone = sampleTrack(prepared, tMs, resolveHeading(track.headings, s.mapHeading));
  const view = computeMapView(prepared, drone, s, rect);
  const u = rect.h / 300; // style unit: sizes scale with the overlay
  const provider = providerFor(s);

  ctx.save();
  clipShape(ctx, s.mapShape, rect, 10 * u);
  ctx.clip();

  // Background + tiles share the map opacity; markers stay fully opaque.
  ctx.globalAlpha = s.mapOpacity;
  ctx.fillStyle = MAP_BG;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  if (provider && tiles) {
    for (const layer of provider.layers) drawTiles(ctx, tiles, layer, view);
  }
  ctx.globalAlpha = 1;

  drawTrail(ctx, prepared, view, tMs, s, u);

  // Home marker: in place when in view, otherwise pinned to the edge.
  let home: { x: number; y: number; onEdge: boolean } | undefined;
  if (s.mapShowHome && prepared.home) {
    const [hx, hy] = worldToScreen(view, prepared.home.x, prepared.home.y);
    // Inset enough that the outward arrow (tip at HOME_R + 4u) stays visible.
    const edge = projectToEdge(s.mapShape, rect, (HOME_R + 6) * u, hx, hy);
    home = edge.inside ? { x: hx, y: hy, onEdge: false } : { x: edge.x, y: edge.y, onEdge: true };
  }

  // An in-view home sits under the drone; the edge marker and label go on top.
  if (home && !home.onEdge) drawHome(ctx, home.x, home.y, HOME_R * u, u);

  const [dx, dy] = worldToScreen(view, drone.x, drone.y);
  drawDrone(ctx, dx, dy, drone.heading, u);

  if (home && prepared.home) {
    if (home.onEdge) drawHomeEdge(ctx, rect, home.x, home.y, u);
    if (s.mapShowHomeDistance) {
      const dist = haversineM(drone.lat, drone.lon, prepared.home.lat, prepared.home.lon);
      drawHomeDistance(ctx, s.mapShape, rect, home, formatDistance(dist), u);
    }
  }

  if (provider) drawAttribution(ctx, s.mapShape, rect, provider.attribution);
  ctx.restore();

  // Border.
  ctx.save();
  clipShape(ctx, s.mapShape, rect, 10 * u);
  ctx.lineWidth = Math.max(1, 2 * u);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.stroke();
  ctx.restore();
}

/**
 * Every tile (of every layer) the overlay will need between `startMs` and
 * `endMs` (OSD time), so an export can download them up front and render
 * deterministically.
 */
export function collectMapTiles(
  track: GpsTrack,
  s: MapRenderSettings,
  startMs: number,
  endMs: number,
  W: number,
  H: number,
): TileRequest[] {
  const provider = providerFor(s);
  if (!provider) return [];
  const prepared = getPreparedTrack(track, s.mapSmoothing);
  if (prepared.t.length === 0) return [];
  const rect = computeMapRect(s, W, H);

  const keys = new Map<string, TileRequest>();
  const add = (view: MapView) => {
    const { x, y, w, h } = view.rect;
    const padded: MapView = {
      ...view,
      rect: {
        x: x - w * PREFETCH_PAD,
        y: y - h * PREFETCH_PAD,
        w: w * (1 + 2 * PREFETCH_PAD),
        h: h * (1 + 2 * PREFETCH_PAD),
      },
    };
    for (const layer of provider.layers) {
      for (const t of layoutTiles(padded, layer.maxZoom)) {
        keys.set(`${layer.id}/${t.z}/${t.x}/${t.y}`, { layer, z: t.z, x: t.x, y: t.y });
      }
    }
  };

  // The plain whole-trail view never moves, so one layout covers the export.
  const isStatic = s.mapMode === 'overview' && !s.mapAdaptiveZoom;
  const steps = isStatic ? [startMs] : timeSteps(startMs, endMs);
  for (const t of steps) {
    add(computeMapView(prepared, sampleTrack(prepared, t), s, rect));
  }
  return [...keys.values()];
}

function timeSteps(startMs: number, endMs: number): number[] {
  const out: number[] = [];
  for (let t = startMs; t < endMs; t += PREFETCH_STEP_MS) out.push(t);
  out.push(endMs);
  return out;
}

function drawTiles(ctx: Ctx2D, tiles: TileCache, layer: TileLayer, view: MapView) {
  for (const t of layoutTiles(view, layer.maxZoom)) {
    const img = tiles.get(layer, t.z, t.x, t.y);
    if (img) {
      ctx.drawImage(img, t.dx, t.dy, t.dw, t.dh);
      continue;
    }
    // Stretch a cached ancestor tile until this one arrives. If this zoom is
    // missing on the server, download the ancestor instead (one level at a
    // time: only once a level has failed is the next one up requested).
    let missing = tiles.hasFailed(layer, t.z, t.x, t.y);
    for (let up = 1; up <= PARENT_FALLBACK_LEVELS && t.z - up >= 0; up++) {
      const f = 2 ** up;
      const px = Math.floor(t.x / f);
      const py = Math.floor(t.y / f);
      const parent = tiles.get(layer, t.z - up, px, py, missing);
      if (!parent) {
        missing = missing && tiles.hasFailed(layer, t.z - up, px, py);
        continue;
      }
      const sw = parent.width / f;
      const sh = parent.height / f;
      ctx.drawImage(
        parent,
        (t.x - px * f) * sw,
        (t.y - py * f) * sh,
        sw,
        sh,
        t.dx,
        t.dy,
        t.dw,
        t.dh,
      );
      break;
    }
  }
}

function drawTrail(
  ctx: Ctx2D,
  track: PreparedTrack,
  view: MapView,
  tMs: number,
  s: MapRenderSettings,
  u: number,
) {
  const lw = Math.max(1.5, 3 * u);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const { past, future } = trailPolylines(track, tMs, s.mapTrailSeconds);

  const trace = (points: [number, number][]) => {
    ctx.beginPath();
    points.forEach(([wx, wy], i) => {
      const [x, y] = worldToScreen(view, wx, wy);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
  };

  if (s.mapFutureTrail && future.length > 1) {
    trace(future);
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = s.mapTrailColor;
    ctx.lineWidth = lw;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (past.length > 1) {
    trace(past);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
    ctx.lineWidth = lw + 2 * u;
    ctx.stroke();
    ctx.strokeStyle = s.mapTrailColor;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

function drawDrone(ctx: Ctx2D, x: number, y: number, heading: number | undefined, u: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
  ctx.lineWidth = Math.max(1, 1.5 * u);
  ctx.beginPath();
  if (heading === undefined) {
    ctx.arc(0, 0, 5 * u, 0, Math.PI * 2);
  } else {
    // Arrowhead pointing up (north) before rotation.
    const s = 10 * u;
    ctx.rotate(heading);
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.7, s * 0.75);
    ctx.lineTo(0, s * 0.35);
    ctx.lineTo(-s * 0.7, s * 0.75);
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawHome(ctx: Ctx2D, x: number, y: number, r: number, u: number) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = HOME_FILL;
  ctx.fill();
  ctx.lineWidth = Math.max(1, 1.5 * u);
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold ${Math.round(r * 1.2)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('H', x, y + r * 0.05);
  ctx.restore();
}

/** Home marker pinned to the edge, with an arrow pointing toward home. */
function drawHomeEdge(ctx: Ctx2D, rect: MapRect, x: number, y: number, u: number) {
  const r = HOME_R * u;
  const angle = Math.atan2(y - (rect.y + rect.h / 2), x - (rect.x + rect.w / 2));

  // Outward-pointing arrow tip just beyond the marker.
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(r + 4 * u, 0);
  ctx.lineTo(r - 1 * u, -4 * u);
  ctx.lineTo(r - 1 * u, 4 * u);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();

  drawHome(ctx, x, y, r, u);
}

/**
 * Distance pill next to the home marker: on the inward side of an edge marker,
 * otherwise below the marker (above it when there's no room below).
 */
function drawHomeDistance(
  ctx: Ctx2D,
  shape: 'rect' | 'circle',
  rect: MapRect,
  home: { x: number; y: number; onEdge: boolean },
  label: string,
  u: number,
) {
  const r = HOME_R * u;
  const fontPx = Math.max(9, Math.round(11 * u));
  ctx.save();
  ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
  const tw = ctx.measureText(label).width;
  const pad = 3 * u;
  const bw = tw + pad * 2;
  const bh = fontPx + pad * 1.4;

  let lx = home.x;
  let ly: number;
  if (home.onEdge) {
    const angle = Math.atan2(home.y - (rect.y + rect.h / 2), home.x - (rect.x + rect.w / 2));
    const off = r + 4 * u + Math.max(bw, bh) / 2;
    lx -= Math.cos(angle) * off;
    ly = home.y - Math.sin(angle) * off;
  } else {
    const gap = r + 3 * u + bh / 2;
    ly = home.y + gap;
    if (!boxFitsShape(shape, rect, lx, ly, bw, bh)) ly = home.y - gap;
  }
  lx = Math.max(rect.x + bw / 2 + 2, Math.min(rect.x + rect.w - bw / 2 - 2, lx));
  ly = Math.max(rect.y + bh / 2 + 2, Math.min(rect.y + rect.h - bh / 2 - 2, ly));

  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  roundRectPath(ctx, lx - bw / 2, ly - bh / 2, bw, bh, bh / 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, lx, ly + fontPx * 0.05);
  ctx.restore();
}

/** Whether a box centered at (cx, cy) lies fully inside the overlay shape. */
function boxFitsShape(
  shape: 'rect' | 'circle',
  rect: MapRect,
  cx: number,
  cy: number,
  bw: number,
  bh: number,
): boolean {
  const xs = [cx - bw / 2, cx + bw / 2];
  const ys = [cy - bh / 2, cy + bh / 2];
  if (shape === 'circle') {
    const ox = rect.x + rect.w / 2;
    const oy = rect.y + rect.h / 2;
    const R = Math.min(rect.w, rect.h) / 2;
    return xs.every((x) => ys.every((y) => Math.hypot(x - ox, y - oy) <= R));
  }
  return xs[0] >= rect.x && xs[1] <= rect.x + rect.w && ys[0] >= rect.y && ys[1] <= rect.y + rect.h;
}

function drawAttribution(ctx: Ctx2D, shape: 'rect' | 'circle', rect: MapRect, text: string) {
  let fontPx = Math.max(8, rect.h * 0.032);
  ctx.save();
  ctx.font = `${fontPx}px system-ui, sans-serif`;
  let tw = ctx.measureText(text).width;
  const pad = fontPx * 0.35;

  let x: number;
  let y: number;
  if (shape === 'circle') {
    // Centered near the bottom, shrunk to fit the circle's chord there.
    y = rect.y + rect.h * 0.86;
    const r = rect.h / 2;
    const dy = y - (rect.y + r);
    const chord = 2 * Math.sqrt(Math.max(0, r * r - dy * dy)) - pad * 4;
    if (tw > chord && chord > 0) {
      fontPx *= chord / tw;
      ctx.font = `${fontPx}px system-ui, sans-serif`;
      tw = ctx.measureText(text).width;
    }
    x = rect.x + rect.w / 2 - tw / 2;
  } else {
    // Shrink to fit narrow maps (long credits, e.g. satellite + labels).
    const avail = rect.w - pad * 4;
    if (tw > avail && avail > 0) {
      fontPx *= avail / tw;
      ctx.font = `${fontPx}px system-ui, sans-serif`;
      tw = ctx.measureText(text).width;
    }
    x = rect.x + rect.w - tw - pad * 2;
    y = rect.y + rect.h - fontPx - pad;
  }
  ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
  ctx.fillRect(x - pad, y - pad * 0.5, tw + pad * 2, fontPx + pad);
  ctx.fillStyle = '#222';
  ctx.textBaseline = 'top';
  ctx.fillText(text, x, y);
  ctx.restore();
}

function clipShape(ctx: Ctx2D, shape: 'rect' | 'circle', rect: MapRect, radius: number) {
  if (shape === 'circle') {
    ctx.beginPath();
    ctx.arc(rect.x + rect.w / 2, rect.y + rect.h / 2, Math.min(rect.w, rect.h) / 2, 0, Math.PI * 2);
  } else {
    roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, radius);
  }
}

function roundRectPath(ctx: Ctx2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
