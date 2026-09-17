import { OSD_GLYPH_SPACE, type OsdFrame } from '../parsers/osd';
import type { SrtCue } from '../parsers/srt';
import { TILE_W, TILE_H, type FontAtlas } from '../parsers/font';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Grid cell mask: a set of "row*cols+col" indices to hide (e.g. crosshair). */
export type OsdMask = Set<number>;

export interface OsdRenderOptions {
  /** Fraction (0..1) of the target width the OSD grid should span. */
  fitWidth?: number;
  /** Horizontal offset in destination pixels. */
  offsetX?: number;
  /** Vertical offset in destination pixels. */
  offsetY?: number;
  /** Extra scale multiplier applied on top of the fit scale. */
  scale?: number;
  /** Cells to skip drawing. */
  mask?: OsdMask;
  /** Per-cell displacement (in whole grid cells) keyed by source cell index. */
  moves?: Map<number, { dr: number; dc: number }>;
}

export interface SrtPanelOptions {
  /** Field keys to display, in order. */
  fields: string[];
  /** Anchor corner for the panel. */
  anchor?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** One field per line, or all fields joined on a single line. */
  layout?: 'single' | 'multi';
  /** Panel font size in px (destination). */
  fontSize?: number;
  /** Background opacity 0..1. */
  backgroundOpacity?: number;
  /** Padding in px. */
  padding?: number;
  /** Horizontal nudge in destination px (positive = right). */
  offsetX?: number;
  /** Vertical nudge in destination px (positive = down). */
  offsetY?: number;
}

/**
 * Compute the integer-friendly scale and origin to fit the OSD grid over a
 * target of `targetW × targetH`, preserving aspect ratio.
 */
export function computeOsdLayout(
  cols: number,
  rows: number,
  targetW: number,
  targetH: number,
  opts: OsdRenderOptions = {},
): { scale: number; originX: number; originY: number; gridW: number; gridH: number } {
  const fitWidth = opts.fitWidth ?? 1;
  const gridPxW = cols * TILE_W;
  const gridPxH = rows * TILE_H;
  // Fit by width first, then clamp by height so nothing overflows vertically.
  const scaleByWidth = (targetW * fitWidth) / gridPxW;
  const scaleByHeight = targetH / gridPxH;
  const baseScale = Math.min(scaleByWidth, scaleByHeight);
  const scale = baseScale * (opts.scale ?? 1);

  const gridW = gridPxW * scale;
  const gridH = gridPxH * scale;
  const originX = (targetW - gridW) / 2 + (opts.offsetX ?? 0);
  const originY = (targetH - gridH) / 2 + (opts.offsetY ?? 0);
  return { scale, originX, originY, gridW, gridH };
}

/**
 * Draw an OSD frame onto a 2D context using the font atlas. Deterministic:
 * identical inputs produce identical pixels in preview and export.
 */
export function renderOsdFrame(
  ctx: Ctx2D,
  frame: OsdFrame,
  cols: number,
  rows: number,
  font: FontAtlas,
  targetW: number,
  targetH: number,
  opts: OsdRenderOptions = {},
): void {
  const { scale, originX, originY } = computeOsdLayout(cols, rows, targetW, targetH, opts);
  const mask = opts.mask;
  const moves = opts.moves;
  const stepX = TILE_W * scale;
  const stepY = TILE_H * scale;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = r * cols + c;
      const glyph = frame.glyphs[cell];
      if (glyph === OSD_GLYPH_SPACE) continue;
      // Apply the move first, then evaluate the mask against the destination
      // position so masking hides cells by where they end up drawn.
      const move = moves?.get(cell);
      const dr = move ? move.dr : 0;
      const dc = move ? move.dc : 0;
      if (mask && mask.has((r + dr) * cols + (c + dc))) continue;
      font.draw(ctx, originX + (c + dc) * stepX, originY + (r + dr) * stepY, glyph, scale);
    }
  }
}

/**
 * Walksnail telemetry fields that are recorded with one decimal place (volts /
 * Mbps). Number coercion drops trailing `.0`, so we restore fixed precision for
 * display.
 */
const ONE_DECIMAL_FIELDS = new Set(['SBat', 'GBat', 'Bitrate']);

/** Format a telemetry value, preserving the source's fixed decimal precision. */
function formatFieldValue(key: string, value: number | string): string {
  if (typeof value === 'number' && ONE_DECIMAL_FIELDS.has(key)) {
    return value.toFixed(1);
  }
  return String(value);
}

/**
 * Draw a telemetry panel derived from an SRT cue. Kept visually simple and
 * deterministic; styling can grow without changing call sites.
 */
export function renderSrtPanel(
  ctx: Ctx2D,
  cue: SrtCue,
  targetW: number,
  targetH: number,
  opts: SrtPanelOptions,
): void {
  const fontSize = opts.fontSize ?? Math.round(targetH * 0.022);
  const padding = opts.padding ?? Math.round(fontSize * 0.6);
  const anchor = opts.anchor ?? 'bottom-left';
  const layout = opts.layout ?? 'single';
  const lineHeight = Math.round(fontSize * 1.35);

  const parts = opts.fields
    .filter((k) => cue.fields[k] !== undefined)
    .map((k) => `${k}: ${formatFieldValue(k, cue.fields[k])}`);
  if (parts.length === 0) return;

  // Single line joins all fields; multi line puts one field per row.
  const lines = layout === 'single' ? [parts.join('   ')] : parts;

  ctx.save();
  ctx.font = `${fontSize}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.textBaseline = 'top';

  const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const boxW = textW + padding * 2;
  // Height = leading between lines + one glyph height for the last line.
  const boxH = (lines.length - 1) * lineHeight + fontSize + padding * 2;

  const right = anchor.endsWith('right');
  const bottom = anchor.startsWith('bottom');
  const boxX = (right ? targetW - boxW - padding : padding) + (opts.offsetX ?? 0);
  const boxY = (bottom ? targetH - boxH - padding : padding) + (opts.offsetY ?? 0);

  const bgOpacity = opts.backgroundOpacity ?? 0.45;
  if (bgOpacity > 0) {
    ctx.fillStyle = `rgba(0, 0, 0, ${bgOpacity})`;
    ctx.fillRect(boxX, boxY, boxW, boxH);
  }

  ctx.fillStyle = '#ffffff';
  lines.forEach((line, i) => {
    ctx.fillText(line, boxX + padding, boxY + padding + i * lineHeight);
  });
  ctx.restore();
}
