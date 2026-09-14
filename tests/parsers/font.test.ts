import { describe, it, expect } from 'vitest';
import { pageCountFromWidth, glyphRect, TILE_W, TILE_H } from '../../src/lib/parsers/font';

describe('font atlas geometry', () => {
  it('derives page count from image width', () => {
    expect(pageCountFromWidth(TILE_W)).toBe(1);
    expect(pageCountFromWidth(TILE_W * 2)).toBe(2);
    expect(pageCountFromWidth(TILE_W * 4)).toBe(4);
    expect(pageCountFromWidth(0)).toBe(1); // clamped
  });

  it('maps glyph index to the correct source rect', () => {
    expect(glyphRect(0)).toEqual({ sx: 0, sy: 0, sw: TILE_W, sh: TILE_H });
    // glyph 1 -> page 0, row 1
    expect(glyphRect(1)).toEqual({ sx: 0, sy: TILE_H, sw: TILE_W, sh: TILE_H });
    // space (0x20) -> page 0, row 32
    expect(glyphRect(0x20)).toEqual({
      sx: 0,
      sy: 32 * TILE_H,
      sw: TILE_W,
      sh: TILE_H,
    });
    // glyph 0x101 -> page 1, row 1
    expect(glyphRect(0x101)).toEqual({
      sx: TILE_W,
      sy: TILE_H,
      sw: TILE_W,
      sh: TILE_H,
    });
  });
});
