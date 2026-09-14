import {
  Input,
  ALL_FORMATS,
  BlobSource,
  Output,
  Mp4OutputFormat,
  BufferTarget,
  Conversion,
  ConversionCanceledError,
  VideoSample,
} from 'mediabunny';
import type { OverlaySettings } from '../../state/settings';
import { drawOverlay, type OverlaySources } from '../engine/compositor';
import type { ExportOptions, ExportProgress, ExportResult } from './types';

/**
 * True if the browser can encode video with WebCodecs, which Mediabunny needs
 * for transcoding + overlay compositing.
 */
export function isMediabunnySupported(): boolean {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

/**
 * Export the trimmed clip with the overlay burned in, using Mediabunny.
 *
 * Mediabunny decodes the source sequentially (no real-time playback, no manual
 * seeking), composites the overlay per frame via the conversion `process` hook,
 * re-encodes to H.264, and copies the audio track losslessly when possible.
 * This produces deterministic, glitch-free MP4 output with gapless audio.
 *
 * The `process` callback receives each input frame with its *input-file*
 * timestamp, which is exactly the timeline the `.osd`/`.srt` data is aligned to,
 * so the overlay stays in sync regardless of the trim range.
 *
 * @param sources Parsed OSD/SRT/font.
 * @param settings Overlay settings.
 * @param options Export options (trim, size, bitrate, audio).
 * @param videoFile The original video File (read directly by Mediabunny).
 * @param onProgress Progress callback.
 * @param signal Abort signal to cancel the export.
 */
export async function exportWithMediabunny(
  sources: OverlaySources,
  settings: OverlaySettings,
  options: ExportOptions,
  videoFile: File,
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal,
): Promise<ExportResult> {
  if (!isMediabunnySupported()) {
    throw new Error('Video encoding (WebCodecs) is not supported in this browser.');
  }

  const { width, height, startMs, endMs } = options;
  const rangeMs = Math.max(0, endMs - startMs);
  if (rangeMs <= 0) throw new Error('Export range is empty.');

  const input = new Input({ source: new BlobSource(videoFile), formats: ALL_FORMATS });
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });

  // Reusable canvas for compositing each output frame.
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Could not create a 2D drawing context.');

  const conversion = await Conversion.init({
    input,
    output,
    trim: { start: startMs / 1000, end: endMs / 1000 },
    video: {
      bitrate: options.videoBitsPerSecond,
      forceTranscode: true,
      // Signal our composited output dimensions to the encoder.
      processedWidth: width,
      processedHeight: height,
      process: (sample) => {
        // sample.timestamp is the input-file time (seconds), which aligns with
        // the OSD/SRT timelines.
        const tMs = sample.timestamp * 1000;
        ctx.clearRect(0, 0, width, height);
        sample.draw(ctx, 0, 0, width, height);
        drawOverlay(ctx, sources, settings, tMs, width, height);
        // Snapshot the canvas into a new frame (constructor copies pixels).
        return new VideoSample(canvas, {
          timestamp: sample.timestamp,
          duration: sample.duration,
        });
      },
    },
    audio: options.includeAudio ? {} : { discard: true },
  });

  conversion.onProgress = (progress) => {
    onProgress?.({ fraction: progress, elapsedMs: progress * rangeMs });
  };

  if (signal) {
    if (signal.aborted) {
      await conversion.cancel();
      throw new DOMException('Export cancelled', 'AbortError');
    }
    signal.addEventListener('abort', () => void conversion.cancel(), { once: true });
  }

  try {
    await conversion.execute();
  } catch (err) {
    if (err instanceof ConversionCanceledError) {
      throw new DOMException('Export cancelled', 'AbortError');
    }
    throw err;
  }

  const buffer = output.target.buffer;
  if (!buffer) throw new Error('Export produced no data.');

  return {
    blob: new Blob([buffer], { type: 'video/mp4' }),
    mimeType: 'video/mp4',
    durationMs: rangeMs,
  };
}
