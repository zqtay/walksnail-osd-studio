/**
 * Walksnail OSD font atlas loader.
 *
 * Walksnail Avatar glyph tiles are 24x36 px. Because `.osd` glyph indices are
 * 16-bit, a font provides multiple 256-glyph "pages" (Betaflight/INAV convention
 * used by walksnail-osd-tool). Pages are laid out left-to-right; within a page
 * the 256 glyphs are stacked vertically.
 *
 *   page = glyph >> 8
 *   row  = glyph & 0xFF
 *   srcX = page * TILE_W
 *   srcY = row  * TILE_H
 *
 * The page count is derived from the image width so 1-, 2-, and 4-page atlases
 * all work without configuration.
 */

export const TILE_W = 24;
export const TILE_H = 36;
export const GLYPHS_PER_PAGE = 256;

export interface GlyphRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

export interface FontAtlas {
  readonly tileW: number;
  readonly tileH: number;
  readonly pages: number;
  readonly bitmap: ImageBitmap;
  /** Draw a glyph at destination (x, y) scaled by `scale`. */
  draw(
    ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    x: number,
    y: number,
    glyph: number,
    scale: number,
  ): void;
}

/** Pure geometry: derive page count from an atlas image width. */
export function pageCountFromWidth(imageWidth: number, tileW = TILE_W): number {
  return Math.max(1, Math.floor(imageWidth / tileW));
}

/** Pure geometry: source rectangle for a glyph index within the atlas. */
export function glyphRect(glyph: number, tileW = TILE_W, tileH = TILE_H): GlyphRect {
  const page = glyph >> 8;
  const row = glyph & 0xff;
  return { sx: page * tileW, sy: row * tileH, sw: tileW, sh: tileH };
}

/**
 * Build a FontAtlas from an already-decoded ImageBitmap.
 * (Kept separate from loading so it is easy to unit-test the geometry.)
 */
export function createFontAtlas(bitmap: ImageBitmap): FontAtlas {
  const pages = pageCountFromWidth(bitmap.width);
  return {
    tileW: TILE_W,
    tileH: TILE_H,
    pages,
    bitmap,
    draw(ctx, x, y, glyph, scale) {
      const { sx, sy, sw, sh } = glyphRect(glyph);
      ctx.drawImage(bitmap, sx, sy, sw, sh, x, y, sw * scale, sh * scale);
    },
  };
}

/**
 * Load a font atlas from a PNG Blob/File. Browser-only (uses createImageBitmap).
 */
export async function loadFontAtlas(source: Blob): Promise<FontAtlas> {
  const bitmap = await createImageBitmap(source);
  return createFontAtlas(bitmap);
}
