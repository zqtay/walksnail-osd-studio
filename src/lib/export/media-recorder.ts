import type { OverlaySettings } from '../../state/settings';
import { drawOverlay, type OverlaySources } from '../engine/compositor';
import type { ExportOptions, ExportProgress, ExportResult } from './types';

export type { ExportOptions, ExportProgress, ExportResult } from './types';

/** Candidate MIME types in preference order (H.264/MP4 first, then WebM). */
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

/** Pick the first MediaRecorder-supported MIME from an optional preference. */
export function pickMimeType(preferred?: string): string | undefined {
  const list = preferred ? [preferred, ...MIME_CANDIDATES] : MIME_CANDIDATES;
  for (const mime of list) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return undefined;
}

/** File extension for a chosen MIME type. */
export function extensionForMime(mime: string): string {
  return mime.includes('mp4') ? 'mp4' : 'webm';
}

/**
 * Export the trimmed clip with the overlay burned in, using a real-time
 * MediaRecorder capture of an offscreen canvas. Deterministic overlay rendering
 * is shared with the live preview via `drawOverlay`.
 *
 * This path plays the source video through the trim range once; export takes
 * roughly the clip's real-time duration. A WebCodecs (faster-than-real-time)
 * path can be added later behind the same interface.
 *
 * @param video A dedicated <video> element bound to the source (not the preview).
 * @param sources Parsed OSD/SRT/font.
 * @param settings Overlay settings.
 * @param options Export options (trim, size, bitrate, audio).
 * @param onProgress Progress callback.
 * @param signal Abort signal to cancel the export.
 */
export async function exportWithMediaRecorder(
  video: HTMLVideoElement,
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
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create a 2D drawing context.');

  // Compose the canvas stream, optionally mixing in the source audio.
  const canvasStream = canvas.captureStream(0);
  const track = canvasStream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;

  let audioStream: MediaStream | undefined;
  if (options.includeAudio) {
    const withCapture = video as HTMLVideoElement & {
      captureStream?: () => MediaStream;
      mozCaptureStream?: () => MediaStream;
    };
    const capture = withCapture.captureStream ?? withCapture.mozCaptureStream;
    if (capture) {
      const audioTracks = capture.call(video).getAudioTracks();
      if (audioTracks.length > 0) {
        audioStream = new MediaStream(audioTracks);
        canvasStream.addTrack(audioTracks[0]);
      }
    }
  }

  const recorder = new MediaRecorder(canvasStream, {
    mimeType,
    videoBitsPerSecond: options.videoBitsPerSecond,
  });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const cleanup = () => {
    canvasStream.getTracks().forEach((t) => t.stop());
    audioStream?.getTracks().forEach((t) => t.stop());
    video.onended = null;
  };

  return new Promise<ExportResult>((resolve, reject) => {
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      if (recorder.state !== 'inactive') recorder.stop();
    };

    const abort = () => {
      if (finished) return;
      finished = true;
      try {
        video.pause();
      } catch {
        /* ignore */
      }
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

    let rafHandle = 0;
    const renderLoop = () => {
      if (finished) return;
      const tMs = video.currentTime * 1000;

      // Draw the current video frame scaled to the output, then the overlay.
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(video, 0, 0, width, height);
      drawOverlay(ctx, sources, settings, tMs, width, height);
      track.requestFrame();

      const elapsed = tMs - startMs;
      onProgress?.({
        fraction: Math.min(1, Math.max(0, elapsed / rangeMs)),
        elapsedMs: elapsed,
      });

      if (tMs >= endMs) {
        finish();
        return;
      }
      rafHandle = requestAnimationFrame(renderLoop);
    };

    video.onended = () => finish();

    const startPlayback = () => {
      recorder.start();
      void video.play().then(() => {
        rafHandle = requestAnimationFrame(renderLoop);
      }).catch(reject);
    };

    // Seek to the trim start, then begin.
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      startPlayback();
    };
    video.addEventListener('seeked', onSeeked);
    video.currentTime = startMs / 1000;

    // Safety: if seeking to 0 doesn't fire 'seeked', kick off shortly.
    if (startMs === 0 && video.currentTime === 0) {
      video.removeEventListener('seeked', onSeeked);
      startPlayback();
    }

    void rafHandle;
  });
}
