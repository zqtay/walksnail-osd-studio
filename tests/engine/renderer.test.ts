import { describe, it, expect } from 'vitest';
import { computeOsdLayout, renderOsdFrame } from '../../src/lib/engine/renderer';
import { TILE_W, TILE_H, type FontAtlas } from '../../src/lib/parsers/font';
import { OSD_GLYPH_SPACE, type OsdFrame } from '../../src/lib/parsers/osd';

describe('computeOsdLayout', () => {
  it('fits the grid within the target and centers it', () => {
    const cols = 53;
    const rows = 20;
    const targetW = 1920;
    const targetH = 1080;
    const layout = computeOsdLayout(cols, rows, targetW, targetH);

    // Grid must not exceed the target in either dimension.
    expect(layout.gridW).toBeLessThanOrEqual(targetW + 0.001);
    expect(layout.gridH).toBeLessThanOrEqual(targetH + 0.001);

    // Centered.
    expect(layout.originX).toBeCloseTo((targetW - layout.gridW) / 2, 5);
    expect(layout.originY).toBeCloseTo((targetH - layout.gridH) / 2, 5);
  });

  it('applies extra scale and offsets', () => {
    const base = computeOsdLayout(10, 10, 1000, 1000);
    const scaled = computeOsdLayout(10, 10, 1000, 1000, {
      scale: 0.5,
      offsetX: 20,
      offsetY: -10,
    });
    expect(scaled.scale).toBeCloseTo(base.scale * 0.5, 5);
    expect(scaled.originX).toBeGreaterThan((1000 - scaled.gridW) / 2 + 19);
  });

  it('scale is based on the smaller of width/height fit', () => {
    // Wide target: height limits the scale.
    const layout = computeOsdLayout(1, 1, 10000, TILE_H);
    expect(layout.scale).toBeCloseTo(TILE_H / TILE_H, 5); // == 1
    expect(layout.gridW).toBeCloseTo(TILE_W, 5);
  });
});

/** A draw call recorded by the mock font atlas. */
interface DrawCall {
  x: number;
  y: number;
  glyph: number;
  scale: number;
}

/** Font atlas stub that records draw calls instead of touching a canvas. */
function mockFont(): { font: FontAtlas; calls: DrawCall[] } {
  const calls: DrawCall[] = [];
  const font = {
    tileW: TILE_W,
    tileH: TILE_H,
    pages: 1,
    bitmap: {} as ImageBitmap,
    draw(_ctx: unknown, x: number, y: number, glyph: number, scale: number) {
      calls.push({ x, y, glyph, scale });
    },
  } as unknown as FontAtlas;
  return { font, calls };
}

/** Build a frame with the given glyphs (by cell index); the rest are spaces. */
function makeFrame(cols: number, rows: number, glyphs: Record<number, number>): OsdFrame {
  const arr = new Uint16Array(cols * rows).fill(OSD_GLYPH_SPACE);
  for (const [cell, g] of Object.entries(glyphs)) arr[Number(cell)] = g;
  return { t: 0, glyphs: arr };
}

/** Dummy 2D context; the mock font never uses it. */
const CTX = {} as CanvasRenderingContext2D;

describe('renderOsdFrame masking and moves', () => {
  const cols = 4;
  const rows = 3;
  const targetW = 400;
  const targetH = 300;
  const layout = computeOsdLayout(cols, rows, targetW, targetH);
  const stepX = TILE_W * layout.scale;
  const stepY = TILE_H * layout.scale;
  const posOf = (r: number, c: number) => ({
    x: layout.originX + c * stepX,
    y: layout.originY + r * stepY,
  });

  it('draws non-space glyphs and skips spaces', () => {
    // Glyph 'A' (65) at cell 5 (r1,c1); everything else is a space.
    const frame = makeFrame(cols, rows, { 5: 65 });
    const { font, calls } = mockFont();
    renderOsdFrame(CTX, frame, cols, rows, font, targetW, targetH);

    expect(calls).toHaveLength(1);
    const { x, y } = posOf(1, 1);
    expect(calls[0].glyph).toBe(65);
    expect(calls[0].x).toBeCloseTo(x, 5);
    expect(calls[0].y).toBeCloseTo(y, 5);
  });

  it('skips masked cells', () => {
    const frame = makeFrame(cols, rows, { 5: 65, 6: 66 });
    const { font, calls } = mockFont();
    renderOsdFrame(CTX, frame, cols, rows, font, targetW, targetH, {
      mask: new Set([5]),
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].glyph).toBe(66);
  });

  it('displaces a glyph by its move (dRow, dCol)', () => {
    // Move cell 5 (r1,c1) by +1 row, +2 cols -> destination (r2,c3).
    const frame = makeFrame(cols, rows, { 5: 65 });
    const { font, calls } = mockFont();
    renderOsdFrame(CTX, frame, cols, rows, font, targetW, targetH, {
      moves: new Map([[5, { dr: 1, dc: 2 }]]),
    });

    expect(calls).toHaveLength(1);
    const { x, y } = posOf(2, 3);
    expect(calls[0].x).toBeCloseTo(x, 5);
    expect(calls[0].y).toBeCloseTo(y, 5);
  });

  it('evaluates the mask at the destination, hiding a glyph moved into a masked cell', () => {
    // Cell 5 moves to destination cell 7 (r1,c3); cell 7 is masked.
    const frame = makeFrame(cols, rows, { 5: 65 });
    const { font, calls } = mockFont();
    renderOsdFrame(CTX, frame, cols, rows, font, targetW, targetH, {
      moves: new Map([[5, { dr: 0, dc: 2 }]]),
      mask: new Set([7]),
    });

    expect(calls).toHaveLength(0);
  });

  it('shows a masked source cell once it is moved out of the masked position', () => {
    // Cell 5 is masked, but moving it to (r1,c2)=cell 6 (unmasked) makes it show.
    const frame = makeFrame(cols, rows, { 5: 65 });
    const { font, calls } = mockFont();
    renderOsdFrame(CTX, frame, cols, rows, font, targetW, targetH, {
      moves: new Map([[5, { dr: 0, dc: 1 }]]),
      mask: new Set([5]),
    });

    expect(calls).toHaveLength(1);
    const { x, y } = posOf(1, 2);
    expect(calls[0].x).toBeCloseTo(x, 5);
    expect(calls[0].y).toBeCloseTo(y, 5);
  });

  it('leaves unmoved glyphs in place while displacing moved ones', () => {
    // Cell 1 (r0,c1) stays; cell 5 (r1,c1) moves to (r1,c2).
    const frame = makeFrame(cols, rows, { 1: 65, 5: 66 });
    const { font, calls } = mockFont();
    renderOsdFrame(CTX, frame, cols, rows, font, targetW, targetH, {
      moves: new Map([[5, { dr: 0, dc: 1 }]]),
    });

    expect(calls).toHaveLength(2);
    const byGlyph = new Map(calls.map((d) => [d.glyph, d]));
    const stay = posOf(0, 1);
    expect(byGlyph.get(65)!.x).toBeCloseTo(stay.x, 5);
    expect(byGlyph.get(65)!.y).toBeCloseTo(stay.y, 5);
    const moved = posOf(1, 2);
    expect(byGlyph.get(66)!.x).toBeCloseTo(moved.x, 5);
    expect(byGlyph.get(66)!.y).toBeCloseTo(moved.y, 5);
  });
});
