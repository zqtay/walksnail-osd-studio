import { useEffect, useRef, useState } from 'react';
import { computeMapRect, type MapLayoutSettings } from '../lib/map/view';
import type { OverlaySettings } from '../state/settings';

interface MapEditorProps {
  /** Native video dimensions (canvas coordinate space). */
  videoWidth: number;
  videoHeight: number;
  settings: MapLayoutSettings;
  onChange: (patch: Partial<Pick<OverlaySettings, 'mapX' | 'mapY' | 'mapSize'>>) => void;
}

/** Smallest overlay height (fraction of output height) when resizing. */
const MIN_SIZE = 0.08;
const MAX_SIZE = 0.9;

interface DragState {
  kind: 'move' | 'resize';
  startX: number;
  startY: number;
  /** Rect in output pixels when the drag began. */
  rect: { x: number; y: number; w: number; h: number };
}

/**
 * Transparent handle over the map overlay in the preview: drag the body to move
 * it, drag the corner to resize. Uses the same `computeMapRect` as the renderer
 * so the handle always lines up with the drawn map.
 */
export function MapEditor({ videoWidth, videoHeight, settings, onChange }: MapEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const drag = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);

  // Track the frame size to map output pixels to CSS pixels.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // object-fit: contain letterboxing of the canvas inside the frame.
  const k = box.w > 0 && box.h > 0 ? Math.min(box.w / videoWidth, box.h / videoHeight) : 0;
  const padX = (box.w - videoWidth * k) / 2;
  const padY = (box.h - videoHeight * k) / 2;
  const rect = computeMapRect(settings, videoWidth, videoHeight);

  function onPointerDown(e: React.PointerEvent, kind: DragState['kind']) {
    e.stopPropagation();
    e.preventDefault();
    drag.current = { kind, startX: e.clientX, startY: e.clientY, rect };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || k === 0) return;
    // Pointer delta in output pixels.
    const dx = (e.clientX - d.startX) / k;
    const dy = (e.clientY - d.startY) / k;

    if (d.kind === 'move') {
      const x = Math.max(0, Math.min(videoWidth - d.rect.w, d.rect.x + dx));
      const y = Math.max(0, Math.min(videoHeight - d.rect.h, d.rect.y + dy));
      onChange({ mapX: x / videoWidth, mapY: y / videoHeight });
      return;
    }

    // Resize from the bottom-right corner, keeping the aspect ratio and the
    // top-left corner fixed. Average both axes so diagonal drags feel natural.
    const aspect = d.rect.w / d.rect.h;
    const h = d.rect.h + (dx / aspect + dy) / 2;
    const maxH = Math.min(videoHeight - d.rect.y, (videoWidth - d.rect.x) / aspect);
    const size = Math.max(MIN_SIZE * videoHeight, Math.min(maxH, h, MAX_SIZE * videoHeight));
    onChange({ mapSize: size / videoHeight });
  }

  function onPointerUp(e: React.PointerEvent) {
    drag.current = null;
    setDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }

  return (
    <div ref={rootRef} className="map-editor">
      {k > 0 && (
        <div
          className={`map-editor__box${dragging ? ' map-editor__box--active' : ''}${
            settings.mapShape === 'circle' ? ' map-editor__box--circle' : ''
          }`}
          style={{
            left: padX + rect.x * k,
            top: padY + rect.y * k,
            width: rect.w * k,
            height: rect.h * k,
          }}
          title="Drag to move the map"
          onPointerDown={(e) => onPointerDown(e, 'move')}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          <div
            className="map-editor__handle"
            title="Drag to resize the map"
            // Move/up events bubble to the box's handlers while captured here.
            onPointerDown={(e) => onPointerDown(e, 'resize')}
          />
        </div>
      )}
    </div>
  );
}
