import { useEffect, useRef } from 'react';
import { computeOsdLayout } from '../engine/renderer';
import { TILE_W, TILE_H } from '../parsers/font';

interface MaskEditorProps {
  cols: number;
  rows: number;
  /** Native video dimensions (canvas coordinate space). */
  videoWidth: number;
  videoHeight: number;
  /** OSD placement, matching the render settings. */
  offsetX: number;
  offsetY: number;
  scale: number;
  /** Currently hidden cells (row*cols+col). */
  mask: number[];
  onChange: (mask: number[]) => void;
}

/**
 * Interactive overlay for manual OSD masking. Drag across the OSD area to toggle
 * grid cells; the first cell you touch decides whether the stroke adds or
 * removes (paint vs. erase). Shares `computeOsdLayout` with the renderer so the
 * highlighted cells map exactly to the drawn glyphs.
 */
export function MaskEditor({
  cols,
  rows,
  videoWidth,
  videoHeight,
  offsetX,
  offsetY,
  scale,
  mask,
  onChange,
}: MaskEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const painting = useRef<{ mode: 'add' | 'remove'; set: Set<number> } | null>(null);

  // Redraw the grid + masked-cell highlights whenever inputs change.
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

    // Masked cells.
    ctx.fillStyle = 'rgba(255, 80, 80, 0.4)';
    for (const cell of mask) {
      const r = Math.floor(cell / cols);
      const c = cell % cols;
      ctx.fillRect(originX + c * stepX, originY + r * stepY, stepX, stepY);
    }
  }, [cols, rows, videoWidth, videoHeight, offsetX, offsetY, scale, mask]);

  /** Map a pointer event to a grid cell index, or null if outside the grid. */
  function cellAt(e: React.PointerEvent): number | null {
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
    return r * cols + c;
  }

  function onPointerDown(e: React.PointerEvent) {
    const cell = cellAt(e);
    const set = new Set(mask);
    const mode: 'add' | 'remove' = cell !== null && set.has(cell) ? 'remove' : 'add';
    painting.current = { mode, set };
    canvasRef.current?.setPointerCapture(e.pointerId);
    applyCell(cell);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!painting.current) return;
    applyCell(cellAt(e));
  }

  function onPointerUp(e: React.PointerEvent) {
    painting.current = null;
    canvasRef.current?.releasePointerCapture(e.pointerId);
  }

  function applyCell(cell: number | null) {
    const state = painting.current;
    if (!state || cell === null) return;
    const before = state.set.size;
    if (state.mode === 'add') state.set.add(cell);
    else state.set.delete(cell);
    if (state.set.size !== before) onChange([...state.set].sort((a, b) => a - b));
  }

  return (
    <canvas
      ref={canvasRef}
      className="mask-editor"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
}
