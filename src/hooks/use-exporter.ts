import { useEffect, useRef, useState } from 'react';
import {
  exportWithMediaRecorder,
  extensionForMime,
} from '../lib/export/media-recorder';
import type { OverlaySources } from '../lib/engine/compositor';
import { collectMapTiles } from '../lib/map/map-renderer';
import { estimateRemainingMs } from '../lib/export/eta';
import type { OverlaySettings } from '../state/settings';
import type { ExportUiState } from '../components/panel/export-panel';
import type { NativeSize } from './use-player';

/** Lightweight capability check (no Mediabunny import) for the export path. */
export const canHighQualityExport =
  typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';

/** Default export configuration (resolution is overridden by the native size). */
const DEFAULT_EXPORT_UI: ExportUiState = {
  width: 1920,
  height: 1080,
  bitrateMbps: 40,
  includeAudio: true,
};

interface UseExporterArgs {
  sources: OverlaySources;
  settings: OverlaySettings;
  videoName: string | undefined;
  videoFile: File | undefined;
  /** Base filename for the export when no video is loaded (e.g. from .osd/.srt). */
  baseName: string;
  /** True when OSD/SRT data is available to export without a video. */
  hasOverlay: boolean;
  /** Export the overlay over the background color instead of the video. */
  preferBackground: boolean;
  trimStartMs: number;
  trimEndMs: number;
  nativeSize: NativeSize;
  onError: (message: string) => void;
}

export interface UseExporter {
  /** Attach to the dedicated, off-screen export <video> element. */
  exportVideoRef: React.RefObject<HTMLVideoElement>;
  exportUi: ExportUiState;
  setExportUi: (patch: Partial<ExportUiState>) => void;
  resetExportUi: () => void;
  exporting: boolean;
  progress: number;
  /** Human-readable step shown while preparing the export, if any. */
  status: string | undefined;
  /** Estimated milliseconds left while encoding; undefined until known. */
  remainingMs: number | undefined;
  runExport: () => Promise<void>;
  cancelExport: () => void;
}

/**
 * Owns export configuration and drives the burn-in export, preferring the
 * high-quality Mediabunny (WebCodecs) path and falling back to MediaRecorder.
 * Output resolution defaults track the loaded video's native size.
 */
export function useExporter({
  sources,
  settings,
  videoName,
  videoFile,
  baseName,
  hasOverlay,
  preferBackground,
  trimStartMs,
  trimEndMs,
  nativeSize,
  onError,
}: UseExporterArgs): UseExporter {
  const exportVideoRef = useRef<HTMLVideoElement>(null);
  const [exportUi, setExportUiState] = useState<ExportUiState>(DEFAULT_EXPORT_UI);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string>();
  const [remainingMs, setRemainingMs] = useState<number>();
  const abortRef = useRef<AbortController | null>(null);

  // Default the output resolution to the video's native size when it loads.
  useEffect(() => {
    setExportUiState((prev) => ({ ...prev, width: nativeSize.w, height: nativeSize.h }));
  }, [nativeSize.w, nativeSize.h]);

  const setExportUi = (patch: Partial<ExportUiState>) =>
    setExportUiState((prev) => ({ ...prev, ...patch }));

  // Reset to defaults, keeping the resolution matched to the native size.
  const resetExportUi = () =>
    setExportUiState({ ...DEFAULT_EXPORT_UI, width: nativeSize.w, height: nativeSize.h });

  async function runExport() {
    const exportVideo = exportVideoRef.current;
    if (!videoName && !hasOverlay) return;
    setExporting(true);
    setProgress(0);
    setRemainingMs(undefined);
    const controller = new AbortController();
    abortRef.current = controller;

    const exportOptions = {
      startMs: trimStartMs,
      endMs: trimEndMs,
      width: exportUi.width,
      height: exportUi.height,
      videoBitsPerSecond: exportUi.bitrateMbps * 1_000_000,
      includeAudio: exportUi.includeAudio,
      // When the user chose the background over the video, replace the video
      // frames with the background color while still keeping the audio track.
      backgroundColor: preferBackground ? settings.bgColor : undefined,
    };

    try {
      await prefetchMapTiles(controller.signal);
      setStatus(undefined);

      // Time the encode itself (tile downloads above have their own status).
      const encodeStart = performance.now();
      const onProgress = (p: { fraction: number }) => {
        setProgress(p.fraction);
        setRemainingMs(estimateRemainingMs(p.fraction, performance.now() - encodeStart));
      };

      let result;
      if (videoFile && canHighQualityExport) {
        const { exportWithMediabunny } = await import('../lib/export/mediabunny');
        result = await exportWithMediabunny(
          sources,
          settings,
          exportOptions,
          videoFile,
          onProgress,
          controller.signal,
        );
      } else if (videoFile && exportVideo) {
        result = await exportWithMediaRecorder(
          exportVideo,
          sources,
          settings,
          exportOptions,
          onProgress,
          controller.signal,
        );
      } else if (hasOverlay || preferBackground) {
        const { exportOverlayOnly } = await import('../lib/export/overlay-only');
        result = await exportOverlayOnly(
          sources,
          settings,
          exportOptions,
          onProgress,
          controller.signal,
        );
      } else {
        return;
      }

      const ext = extensionForMime(result.mimeType);
      const base = (videoName ?? baseName).replace(/\.[^.]+$/, '');
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${base}-osd.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        onError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setExporting(false);
      setProgress(0);
      setRemainingMs(undefined);
      setStatus(undefined);
      abortRef.current = null;
    }
  }

  /**
   * Download every map tile the export will draw, so the frame-by-frame render
   * never hits a missing tile. Failures (e.g. offline) are tolerated: those
   * areas fall back to a lower-zoom tile or the plain map background.
   */
  async function prefetchMapTiles(signal: AbortSignal) {
    const { gps, tiles } = sources;
    if (!settings.mapEnabled || !gps || !tiles || settings.mapTiles === 'none') return;
    const offset = settings.osdOffsetMs;
    const keys = collectMapTiles(
      gps,
      settings,
      trimStartMs - offset,
      trimEndMs - offset,
      exportUi.width,
      exportUi.height,
    );
    if (keys.length === 0) return;
    setStatus(`Downloading map tiles 0/${keys.length}…`);
    const { failed } = await tiles.prefetch(
      keys,
      signal,
      (done, total) => setStatus(`Downloading map tiles ${done}/${total}…`),
    );
    if (failed > 0) {
      console.warn(`Map: ${failed} of ${keys.length} tiles could not be downloaded.`);
    }
  }

  function cancelExport() {
    abortRef.current?.abort();
  }

  return {
    exportVideoRef,
    exportUi,
    setExportUi,
    resetExportUi,
    exporting,
    progress,
    status,
    remainingMs,
    runExport,
    cancelExport,
  };
}
