import { useEffect, useRef, useState } from 'react';
import {
  exportWithMediaRecorder,
  extensionForMime,
} from '../lib/export/media-recorder';
import type { OverlaySources } from '../lib/engine/compositor';
import type { OverlaySettings } from '../state/settings';
import type { ExportUiState } from '../components/panel/export-panel';
import type { NativeSize } from './use-player';

/** Lightweight capability check (no Mediabunny import) for the export path. */
export const canHighQualityExport =
  typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';

interface UseExporterArgs {
  sources: OverlaySources;
  settings: OverlaySettings;
  videoName: string | undefined;
  videoFile: File | undefined;
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
  exporting: boolean;
  progress: number;
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
  trimStartMs,
  trimEndMs,
  nativeSize,
  onError,
}: UseExporterArgs): UseExporter {
  const exportVideoRef = useRef<HTMLVideoElement>(null);
  const [exportUi, setExportUiState] = useState<ExportUiState>({
    width: 1920,
    height: 1080,
    bitrateMbps: 40,
    includeAudio: true,
  });
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // Default the output resolution to the video's native size when it loads.
  useEffect(() => {
    setExportUiState((prev) => ({ ...prev, width: nativeSize.w, height: nativeSize.h }));
  }, [nativeSize.w, nativeSize.h]);

  const setExportUi = (patch: Partial<ExportUiState>) =>
    setExportUiState((prev) => ({ ...prev, ...patch }));

  async function runExport() {
    const exportVideo = exportVideoRef.current;
    if (!videoName) return;
    setExporting(true);
    setProgress(0);
    const controller = new AbortController();
    abortRef.current = controller;

    const exportOptions = {
      startMs: trimStartMs,
      endMs: trimEndMs,
      width: exportUi.width,
      height: exportUi.height,
      videoBitsPerSecond: exportUi.bitrateMbps * 1_000_000,
      includeAudio: exportUi.includeAudio,
    };

    try {
      let result;
      if (canHighQualityExport && videoFile) {
        const { exportWithMediabunny } = await import('../lib/export/mediabunny');
        result = await exportWithMediabunny(
          sources,
          settings,
          exportOptions,
          videoFile,
          (p) => setProgress(p.fraction),
          controller.signal,
        );
      } else if (exportVideo) {
        result = await exportWithMediaRecorder(
          exportVideo,
          sources,
          settings,
          exportOptions,
          (p) => setProgress(p.fraction),
          controller.signal,
        );
      } else {
        return;
      }

      const ext = extensionForMime(result.mimeType);
      const base = videoName.replace(/\.[^.]+$/, '');
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
      abortRef.current = null;
    }
  }

  function cancelExport() {
    abortRef.current?.abort();
  }

  return {
    exportVideoRef,
    exportUi,
    setExportUi,
    exporting,
    progress,
    runExport,
    cancelExport,
  };
}
