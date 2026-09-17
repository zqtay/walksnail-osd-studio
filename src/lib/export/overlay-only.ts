import {
  Output,
  Mp4OutputFormat,
  BufferTarget,
  CanvasSource,
  getFirstEncodableVideoCodec,
} from 'mediabunny';
import type { OverlaySettings } from '../../state/settings';
import { drawOverlay, type OverlaySources } from '../engine/compositor';
import {
  extensionForMime,
  pickMimeType,
} from './media-recorder';
import type { ExportOptions, ExportProgress, ExportResult } from './types';

/** Frame rate used to render the synthetic (video-less) overlay clip. */
const OVERLAY_FPS = 30;

/**
 * True if the browser can encode video with WebCodecs, which the high-quality
 * overlay-only path needs.
 */
function isWebCodecsSupported(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

/**
 * Export the overlay (OSD grid + telemetry) on its own, with no source video,
 * rendered over the configured background color. Produces a fixed-fps clip whose
 * length matches the trim range.
 *
 * Prefers the deterministic WebCodecs path (Mediabunny `CanvasSource` -> MP4)
 * and falls back to a real-time MediaRecorder capture when WebCodecs is absent.
 *
 * The OSD/SRT timelines are file-relative, so each rendered frame's overlay is
 * looked up at `startMs + frameTime` to honor the trim start.
 */
export async function exportOverlayOnly(
  sources: OverlaySources,
  settings: OverlaySettings,
  options: ExportOptions,
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<ExportResult> {
  if (isWebCodecsSupported()) {
    return exportOverlayWebCodecs(sources, settings, options, onProgress, signal);
  }
  return exportOverlayMediaRecorder(sources, settings, options, onProgress, signal);
}

/** WebCodecs/Mediabunny overlay-only export (deterministic, faster than realtime). */
async function exportOverlayWebCodecs(
  sources: OverlaySources,
  settings: OverlaySettings,
  options: ExportOptions,
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<ExportResult> {
  const { width, height, startMs, endMs, videoBitsPerSecond } = options;
  const rangeMs = Math.max(0, endMs - startMs);
  if (rangeMs <= 0) throw new Error('Export range is empty.');

  const frameCount = Math.max(1, Math.round((rangeMs / 1000) * OVERLAY_FPS));
  const frameDurSec = 1 / OVERLAY_FPS;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Could not create a 2D drawing context.');

  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
  const codec =
    (await getFirstEncodableVideoCodec(output.format.getSupportedVideoCodecs(), {
      width,
      height,
    })) ?? 'avc';
  const source = new CanvasSource(canvas, { codec, bitrate: videoBitsPerSecond });
  output.addVideoTrack(source);
  await output.start();

  const abortAndThrow = async () => {
    await output.cancel();
    throw new DOMException('Export cancelled', 'AbortError');
  };

  try {
    for (let i = 0; i < frameCount; i++) {
      if (signal?.aborted) await abortAndThrow();

      const tMs = startMs + (i / OVERLAY_FPS) * 1000;
      ctx.fillStyle = settings.bgColor;
      ctx.fillRect(0, 0, width, height);
      drawOverlay(ctx, sources, settings, tMs, width, height);

      await source.add(i * frameDurSec, frameDurSec);
      onProgress?.({
        fraction: (i + 1) / frameCount,
        elapsedMs: ((i + 1) / OVERLAY_FPS) * 1000,
      });
    }
  } catch (err) {
    if (output.state !== 'canceled' && output.state !== 'finalized') {
      await output.cancel();
    }
    throw err;
  }

  await output.finalize();

  const buffer = output.target.buffer;
  if (!buffer) throw new Error('Export produced no data.');

  return {
    blob: new Blob([buffer], { type: 'video/mp4' }),
    mimeType: 'video/mp4',
    durationMs: rangeMs,
  };
}

/** Real-time MediaRecorder fallback for the overlay-only export. */
function exportOverlayMediaRecorder(
  sources: OverlaySources,
  settings: OverlaySettings,
  options: ExportOptions,
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<ExportResult> {
  const mimeType = pickMimeType(options.mimeType);
  if (!mimeType) {
    throw new Error('No supported video MIME type for MediaRecorder in this browser.');
  }

  const { width, height, startMs, endMs } = options;
  const rangeMs = Math.max(0, endMs - startMs);
  if (rangeMs <= 0) throw new Error('Export range is empty.');

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Could not create a 2D drawing context.');

  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: options.videoBitsPerSecond,
  });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const cleanup = () => stream.getTracks().forEach((t) => t.stop());

  return new Promise<ExportResult>((resolve, reject) => {
    let finished = false;
    let rafHandle = 0;
    let startPerf = 0;

    const finish = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(rafHandle);
      if (recorder.state !== 'inactive') recorder.stop();
    };

    const abort = () => {
      if (finished) return;
      finished = true;
      cancelAnimationFrame(rafHandle);
      if (recorder.state !== 'inactive') recorder.stop();
      cleanup();
      reject(new DOMException('Export cancelled', 'AbortError'));
    };

    if (signal) {
      if (signal.aborted) return abort();
      signal.addEventListener('abort', abort, { once: true });
    }

    recorder.onstop = () => {
      if (signal?.aborted) return; // already rejected by abort()
      cleanup();
      resolve({ blob: new Blob(chunks, { type: mimeType }), mimeType, durationMs: rangeMs });
    };
    recorder.onerror = (e) => {
      cleanup();
      reject((e as unknown as { error?: Error }).error ?? new Error('Recorder error.'));
    };

    const renderLoop = (now: number) => {
      if (finished) return;
      const elapsed = now - startPerf;
      const tMs = startMs + elapsed;

      ctx.fillStyle = settings.bgColor;
      ctx.fillRect(0, 0, width, height);
      drawOverlay(ctx, sources, settings, tMs, width, height);
      track.requestFrame();

      onProgress?.({
        fraction: Math.min(1, Math.max(0, elapsed / rangeMs)),
        elapsedMs: elapsed,
      });

      if (elapsed >= rangeMs) {
        finish();
        return;
      }
      rafHandle = requestAnimationFrame(renderLoop);
    };

    recorder.start();
    startPerf = performance.now();
    rafHandle = requestAnimationFrame(renderLoop);
  });
}

export { extensionForMime };
