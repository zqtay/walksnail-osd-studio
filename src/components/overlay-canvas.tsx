import { useEffect, useRef } from 'react';
import type { OsdData } from '../lib/parsers/osd';
import type { SrtData } from '../lib/parsers/srt';
import type { FontAtlas } from '../lib/parsers/font';
import { drawOverlay } from '../lib/engine/compositor';
import type { OverlaySettings } from '../state/settings';

interface OverlayCanvasProps {
  video: HTMLVideoElement | null;
  osd?: OsdData;
  srt?: SrtData;
  font?: FontAtlas;
  settings: OverlaySettings;
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
export function OverlayCanvas({ video, osd, srt, font, settings }: OverlayCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const v = video as VideoWithRVFC;
    let rvfcHandle: RVFCHandle | null = null;
    let rafHandle: number | null = null;
    let cancelled = false;

    const draw = () => {
      if (cancelled) return;
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const tMs = video.currentTime * 1000;
      drawOverlay(ctx, { osd, srt, font }, settings, tMs, w, h);

      schedule();
    };

    const schedule = () => {
      if (v.requestVideoFrameCallback) {
        rvfcHandle = v.requestVideoFrameCallback(draw);
      } else {
        rafHandle = requestAnimationFrame(draw);
      }
    };

    // Redraw immediately on relevant events (paused seeking, resize, etc.).
    const kick = () => draw();
    video.addEventListener('seeked', kick);
    video.addEventListener('loadedmetadata', kick);
    schedule();

    return () => {
      cancelled = true;
      video.removeEventListener('seeked', kick);
      video.removeEventListener('loadedmetadata', kick);
      if (rvfcHandle !== null && v.cancelVideoFrameCallback) {
        v.cancelVideoFrameCallback(rvfcHandle);
      }
      if (rafHandle !== null) cancelAnimationFrame(rafHandle);
    };
  }, [video, osd, srt, font, settings]);

  return <canvas ref={canvasRef} className="overlay-canvas" />;
}
