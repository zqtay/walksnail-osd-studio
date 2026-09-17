export interface ExportOptions {
  /** Trim start in ms. */
  startMs: number;
  /** Trim end in ms. */
  endMs: number;
  /** Output width in px (video is drawn scaled to this). */
  width: number;
  /** Output height in px. */
  height: number;
  /** Target video bitrate in bits/sec. */
  videoBitsPerSecond: number;
  /** Include the original audio track. */
  includeAudio: boolean;
  /**
   * When set, the source video frames are replaced by this solid background
   * color (the overlay is still drawn on top). Audio is preserved.
   */
  backgroundColor?: string;
  /** Preferred container/codec MIME (MediaRecorder path); falls back if unsupported. */
  mimeType?: string;
}

export interface ExportProgress {
  /** 0..1 fraction of the trim range processed. */
  fraction: number;
  /** Current output time in ms relative to the trim start. */
  elapsedMs: number;
}

export interface ExportResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}
