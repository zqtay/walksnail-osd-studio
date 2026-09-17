import { useEffect, useRef, useState } from 'react';
import { computeOsdLayout } from '../lib/engine/renderer';
import { TILE_W, TILE_H } from '../lib/parsers/font';
import type { OsdMove } from '../state/settings';

interface MoveEditorProps {
  cols: number;
  rows: number;
  /** Native video dimensions (canvas coordinate space). */
  videoWidth: number;
  videoHeight: number;
  /** OSD placement, matching the render settings. */
  offsetX: number;
  offsetY: number;
  scale: number;
  /** Current per-cell relocations. */
  moves: OsdMove[];
  /** Masked cell indices (row*cols+col) to highlight in red. */
  mask: number[];
  onChange: (moves: OsdMove[]) => void;
}

interface DragState {
  /** Source cell index being moved. */
  cell: number;
  /** Original (unmoved) grid position of the source cell. */
  sr: number;
  sc: number;
  /** Current hovered grid position. */
  hr: number;
  hc: number;
}

/**
 * Interactive overlay for relocating individual OSD cells. Pick up the glyph
 * under the cursor and drop it on another grid position; the displacement is
 * stored per source cell. Dropping a glyph back on its origin clears its move.
 * Shares `computeOsdLayout` with the renderer so cells map exactly to glyphs.
 */
export function MoveEditor({
  cols,
  rows,
  videoWidth,
  videoHeight,
  offsetX,
  offsetY,
  scale,
  moves,
  mask,
  onChange,
}: MoveEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  // Redraw the grid, move arrows, and the active drag ghost on any change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== videoWidth || canvas.height !== videoHeight) {
      canvas.width = videoWidth;
      canvas.height = videoHeight;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, videoWidth, videoHeight);

    const { originX, originY, scale: s } = computeOsdLayout(
      cols,
      rows,
      videoWidth,
      videoHeight,
      { offsetX, offsetY, scale },
    );
    const stepX = TILE_W * s;
    const stepY = TILE_H * s;

    // Grid lines.
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 0; c <= cols; c++) {
      const x = originX + c * stepX;
      ctx.moveTo(x, originY);
      ctx.lineTo(x, originY + rows * stepY);
    }
    for (let r = 0; r <= rows; r++) {
      const y = originY + r * stepY;
      ctx.moveTo(originX, y);
      ctx.lineTo(originX + cols * stepX, y);
    }
    ctx.stroke();

    const cellRect = (r: number, c: number) => ({
      x: originX + c * stepX,
      y: originY + r * stepY,
      w: stepX,
      h: stepY,
    });
    const cellCenter = (r: number, c: number) => ({
      x: originX + (c + 0.5) * stepX,
      y: originY + (r + 0.5) * stepY,
    });

    // Masked cells: red highlight (without hiding the glyph) so the user can see
    // which positions are masked while relocating cells.
    ctx.fillStyle = 'rgba(255, 80, 80, 0.4)';
    for (const cell of mask) {
      const r = Math.floor(cell / cols);
      const c = cell % cols;
      ctx.fillRect(originX + c * stepX, originY + r * stepY, stepX, stepY);
    }

    // Existing moves: outline the origin, highlight the destination, draw arrow.
    ctx.lineWidth = 2;
    for (const [cell, dr, dc] of moves) {
      const sr = Math.floor(cell / cols);
      const sc = cell % cols;
      const tr = sr + dr;
      const tc = sc + dc;

      const src = cellRect(sr, sc);
      ctx.strokeStyle = 'rgba(120, 170, 255, 0.6)';
      ctx.strokeRect(src.x, src.y, src.w, src.h);

      const dst = cellRect(tr, tc);
      ctx.fillStyle = 'rgba(120, 170, 255, 0.28)';
      ctx.fillRect(dst.x, dst.y, dst.w, dst.h);
      ctx.strokeStyle = 'rgba(120, 170, 255, 0.9)';
      ctx.strokeRect(dst.x, dst.y, dst.w, dst.h);

      const a = cellCenter(sr, sc);
      const b = cellCenter(tr, tc);
      ctx.strokeStyle = 'rgba(120, 170, 255, 0.7)';
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Active drag: highlight the hovered destination cell.
    if (drag) {
      const dst = cellRect(drag.hr, drag.hc);
      ctx.fillStyle = 'rgba(120, 255, 170, 0.3)';
      ctx.fillRect(dst.x, dst.y, dst.w, dst.h);
      ctx.strokeStyle = 'rgba(120, 255, 170, 0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(dst.x, dst.y, dst.w, dst.h);
    }
  }, [cols, rows, videoWidth, videoHeight, offsetX, offsetY, scale, moves, mask, drag]);

  /** Map a pointer event to a grid position, or null if outside the grid. */
  function posAt(e: React.PointerEvent): { r: number; c: number } | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();

    // Account for object-fit: contain letterboxing.
    const naturalAspect = videoWidth / videoHeight;
    const elAspect = rect.width / rect.height;
    let contentW: number;
    let contentH: number;
    let padX = 0;
    let padY = 0;
    if (elAspect > naturalAspect) {
      contentH = rect.height;
      contentW = rect.height * naturalAspect;
      padX = (rect.width - contentW) / 2;
    } else {
      contentW = rect.width;
      contentH = rect.width / naturalAspect;
      padY = (rect.height - contentH) / 2;
    }

    const px = ((e.clientX - rect.left - padX) / contentW) * videoWidth;
    const py = ((e.clientY - rect.top - padY) / contentH) * videoHeight;

    const { originX, originY, scale: s } = computeOsdLayout(
      cols,
      rows,
      videoWidth,
      videoHeight,
      { offsetX, offsetY, scale },
    );
    const c = Math.floor((px - originX) / (TILE_W * s));
    const r = Math.floor((py - originY) / (TILE_H * s));
    if (c < 0 || c >= cols || r < 0 || r >= rows) return null;
    return { r, c };
  }

  function onPointerDown(e: React.PointerEvent) {
    const pos = posAt(e);
    if (!pos) return;

    // Grab whichever cell is currently displayed under the cursor: prefer a
    // moved cell whose destination is here, else the cell at this position.
    const moved = moves.find(
      ([cell, dr, dc]) =>
        (cell % cols) + dc === pos.c && Math.floor(cell / cols) + dr === pos.r,
    );
    const cell = moved ? moved[0] : pos.r * cols + pos.c;
    const sr = Math.floor(cell / cols);
    const sc = cell % cols;

    setDrag({ cell, sr, sc, hr: pos.r, hc: pos.c });
    canvasRef.current?.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!drag) return;
    const pos = posAt(e);
    if (!pos) return;
    setDrag({ ...drag, hr: pos.r, hc: pos.c });
  }

  function onPointerUp(e: React.PointerEvent) {
    canvasRef.current?.releasePointerCapture(e.pointerId);
    if (!drag) return;

    const dr = drag.hr - drag.sr;
    const dc = drag.hc - drag.sc;
    const rest = moves.filter(([cell]) => cell !== drag.cell);
    // Dropping back on the origin clears the move.
    const next: OsdMove[] = dr === 0 && dc === 0 ? rest : [...rest, [drag.cell, dr, dc]];
    next.sort((a, b) => a[0] - b[0]);
    onChange(next);
    setDrag(null);
  }

  return (
    <canvas
      ref={canvasRef}
      className="move-editor"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
}
