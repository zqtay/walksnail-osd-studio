import { useEffect, useRef } from 'react';
import type { OsdData } from '../lib/parsers/osd';
import type { SrtData } from '../lib/parsers/srt';
import type { FontAtlas } from '../lib/parsers/font';
import type { GpsTrack } from '../lib/map/gps';
import type { TileCache } from '../lib/map/tiles';
import { drawOverlay } from '../lib/engine/compositor';
import type { OverlaySettings } from '../state/settings';

interface OverlayCanvasProps {
  video: HTMLVideoElement | null;
  osd?: OsdData;
  srt?: SrtData;
  font?: FontAtlas;
  gps?: GpsTrack;
  /** Map tile cache; the canvas repaints when new tiles arrive. */
  tiles?: TileCache;
  settings: OverlaySettings;
  /** Synthetic clock (ms) used when there is no video. */
  timeMs?: number;
  /** Canvas width used when there is no video. */
  width?: number;
  /** Canvas height used when there is no video. */
  height?: number;
  /** Background color filled behind the overlay when there is no video. */
  background?: string;
}

// requestVideoFrameCallback is not in every lib.dom version; access it safely.
type RVFCHandle = number;
type VideoWithRVFC = HTMLVideoElement & {
  requestVideoFrameCallback?(cb: () => void): RVFCHandle;
  cancelVideoFrameCallback?(handle: RVFCHandle): void;
};

/**
 * Canvas overlay that composites the OSD grid and SRT telemetry panel on top of
 * the video, driven by the video's own frame clock for tight sync.
 */
export function OverlayCanvas({
  video,
  osd,
  srt,
  font,
  gps,
  tiles,
  settings,
  timeMs,
  width,
  height,
  background,
}: OverlayCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Video-driven path: composite on the video's own frame clock for tight sync.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const v = video as VideoWithRVFC;
    let rvfcHandle: RVFCHandle | null = null;
    let rafHandle: number | null = null;
    let cancelled = false;

    // Paint the current frame without scheduling another callback.
    const paint = () => {
      if (cancelled) return;
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // When the background replaces the video, paint it over the video-sized
      // canvas so the preview matches the export (which renders at native size).
      if (background) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      const tMs = video.currentTime * 1000;
      drawOverlay(ctx, { osd, srt, font, gps, tiles }, settings, tMs, w, h);
    };

    const draw = () => {
      if (cancelled) return;
      paint();
      schedule();
    };

    const schedule = () => {
      if (v.requestVideoFrameCallback) {
        rvfcHandle = v.requestVideoFrameCallback(draw);
      } else {
        rafHandle = requestAnimationFrame(draw);
      }
    };

    // Repaint immediately on relevant events (paused seeking, resize, newly
    // downloaded map tiles). The frame-callback chain is already running, so
    // these only paint rather than starting another chain.
    const kick = () => paint();
    video.addEventListener('seeked', kick);
    video.addEventListener('loadedmetadata', kick);
    const unsubscribeTiles = tiles?.subscribe(kick);
    // Draw once right away so changes (e.g. background color) are visible even
    // while paused, when requestVideoFrameCallback would not fire.
    draw();

    return () => {
      cancelled = true;
      video.removeEventListener('seeked', kick);
      video.removeEventListener('loadedmetadata', kick);
      unsubscribeTiles?.();
      if (rvfcHandle !== null && v.cancelVideoFrameCallback) {
        v.cancelVideoFrameCallback(rvfcHandle);
      }
      if (rafHandle !== null) cancelAnimationFrame(rafHandle);
    };
  }, [video, osd, srt, font, gps, tiles, settings, background]);

  // Video-less path: redraw over the background color on any input change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || video) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = width ?? 1920;
    const h = height ?? 1080;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const paint = () => {
      ctx.clearRect(0, 0, w, h);
      if (background) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, w, h);
      }
      drawOverlay(ctx, { osd, srt, font, gps, tiles }, settings, timeMs ?? 0, w, h);
    };
    paint();
    return tiles?.subscribe(paint);
  }, [video, osd, srt, font, gps, tiles, settings, timeMs, width, height, background]);

  return <canvas ref={canvasRef} className="overlay-canvas" />;
}
