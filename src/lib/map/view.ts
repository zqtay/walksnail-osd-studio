import type { OverlaySettings } from '../../state/settings';
import type { PreparedTrack, TrackSample } from './track';

/** Map-overlay settings used for layout. */
export type MapLayoutSettings = Pick<
  OverlaySettings,
  'mapX' | 'mapY' | 'mapSize' | 'mapAspect' | 'mapShape' | 'mapMode' | 'mapZoom'
>;

/** Map overlay rectangle in output pixels. */
export interface MapRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * How world coordinates map onto the overlay: the world point `(cx, cy)` sits
 * at the rect center and one world unit spans `unit` pixels.
 */
export interface MapView {
  rect: MapRect;
  cx: number;
  cy: number;
  unit: number;
  /** Effective zoom (one zoom-Z tile spans the rect height). */
  zoom: number;
}

/** A tile to draw, with its destination rectangle. */
export interface TilePlacement {
  z: number;
  /** Tile column wrapped into [0, 2^z). */
  x: number;
  y: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/** Highest zoom the whole-trail view will auto-fit to. */
const OVERVIEW_MAX_ZOOM = 19;
/** Padding (fraction of each side) around the trail in whole-trail view. */
const OVERVIEW_PADDING = 0.12;
/** Native tile size the tile zoom is chosen against. */
const TILE_PX = 256;

/**
 * Overlay rectangle for a `W × H` output. Position and size are stored relative
 * to the output so the map lands in the same place at any export resolution;
 * the rect is clamped to stay fully on screen.
 */
export function computeMapRect(s: MapLayoutSettings, W: number, H: number): MapRect {
  let h = Math.min(H, s.mapSize * H);
  let w = s.mapShape === 'circle' ? h : h * s.mapAspect;
  if (w > W) {
    h *= W / w;
    w = W;
  }
  const x = Math.max(0, Math.min(W - w, s.mapX * W));
  const y = Math.max(0, Math.min(H - h, s.mapY * H));
  return { x, y, w, h };
}

/** Compute the visible map region for the current drone position. */
export function computeMapView(
  track: PreparedTrack,
  drone: TrackSample,
  s: MapLayoutSettings,
  rect: MapRect,
): MapView {
  if (s.mapMode === 'follow') {
    const zoom = s.mapZoom;
    return { rect, cx: drone.x, cy: drone.y, unit: 2 ** zoom * rect.h, zoom };
  }

  // Whole trail: fit the bounding box (trail + home) with some padding.
  const { minX, minY, maxX, maxY } = track.bounds;
  const spanX = Math.max(maxX - minX, 1e-12);
  const spanY = Math.max(maxY - minY, 1e-12);
  const fit = 1 - OVERVIEW_PADDING * 2;
  const maxUnit = 2 ** OVERVIEW_MAX_ZOOM * rect.h;
  const unit = Math.min((rect.w * fit) / spanX, (rect.h * fit) / spanY, maxUnit);
  return {
    rect,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    unit,
    zoom: Math.log2(unit / rect.h),
  };
}

/** Convert a world point to output pixels. */
export function worldToScreen(view: MapView, wx: number, wy: number): [number, number] {
  const { rect } = view;
  return [
    rect.x + rect.w / 2 + (wx - view.cx) * view.unit,
    rect.y + rect.h / 2 + (wy - view.cy) * view.unit,
  ];
}

/** Tile zoom whose tiles render closest to their native size in this view. */
export function tileZoomFor(view: MapView, maxZoom: number): number {
  const z = Math.round(Math.log2(view.unit / TILE_PX));
  return Math.max(0, Math.min(maxZoom, z));
}

/**
 * Tiles covering the view, with pixel-snapped destination rects so adjacent
 * tiles share edges exactly (no hairline seams).
 */
export function layoutTiles(view: MapView, maxZoom: number): TilePlacement[] {
  const z = tileZoomFor(view, maxZoom);
  const n = 2 ** z;
  const { rect } = view;
  const halfW = rect.w / 2 / view.unit;
  const halfH = rect.h / 2 / view.unit;
  const x0 = Math.floor((view.cx - halfW) * n);
  const x1 = Math.floor((view.cx + halfW) * n);
  const y0 = Math.max(0, Math.floor((view.cy - halfH) * n));
  const y1 = Math.min(n - 1, Math.floor((view.cy + halfH) * n));

  const toPx = (wx: number, wy: number) => worldToScreen(view, wx, wy);
  const out: TilePlacement[] = [];
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const [ax, ay] = toPx(tx / n, ty / n);
      const [bx, by] = toPx((tx + 1) / n, (ty + 1) / n);
      const dx = Math.round(ax);
      const dy = Math.round(ay);
      out.push({
        z,
        x: ((tx % n) + n) % n,
        y: ty,
        dx,
        dy,
        dw: Math.round(bx) - dx,
        dh: Math.round(by) - dy,
      });
    }
  }
  return out;
}

/**
 * Place an off-screen point on the overlay edge, along the ray from the rect
 * center towards it. `margin` insets the edge (e.g. marker radius).
 */
export function projectToEdge(
  shape: 'rect' | 'circle',
  rect: MapRect,
  margin: number,
  px: number,
  py: number,
): { x: number; y: number; inside: boolean } {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const dx = px - cx;
  const dy = py - cy;
  const halfW = Math.max(0, rect.w / 2 - margin);
  const halfH = Math.max(0, rect.h / 2 - margin);

  if (shape === 'circle') {
    const r = Math.min(halfW, halfH);
    const d = Math.hypot(dx, dy);
    if (d <= r) return { x: px, y: py, inside: true };
    return { x: cx + (dx / d) * r, y: cy + (dy / d) * r, inside: false };
  }

  if (Math.abs(dx) <= halfW && Math.abs(dy) <= halfH) {
    return { x: px, y: py, inside: true };
  }
  const t = Math.min(
    dx !== 0 ? halfW / Math.abs(dx) : Infinity,
    dy !== 0 ? halfH / Math.abs(dy) : Infinity,
  );
  return { x: cx + dx * t, y: cy + dy * t, inside: false };
}
