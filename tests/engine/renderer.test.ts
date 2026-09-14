import { describe, it, expect } from 'vitest';
import { computeOsdLayout } from '../../src/lib/engine/renderer';
import { TILE_W, TILE_H } from '../../src/lib/parsers/font';

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
