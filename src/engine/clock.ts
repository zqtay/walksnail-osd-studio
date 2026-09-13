import { osdFrameIndexAt, type OsdData, type OsdFrame } from '../parsers/osd';
import { srtCueIndexAt, type SrtCue, type SrtData } from '../parsers/srt';

/**
 * Sync offsets (milliseconds) applied to align each recorded track to the video
 * timeline. Positive values shift the overlay later relative to the video.
 */
export interface SyncOffsets {
  osdMs: number;
  srtMs: number;
}

export const ZERO_OFFSETS: SyncOffsets = { osdMs: 0, srtMs: 0 };

/**
 * Resolve the active OSD frame for a given video time.
 * @param osd Parsed OSD data (may be undefined if not loaded).
 * @param videoTimeMs Current video time in ms.
 * @param offsetMs Sync offset for the OSD track.
 */
export function activeOsdFrame(
  osd: OsdData | undefined,
  videoTimeMs: number,
  offsetMs = 0,
): OsdFrame | undefined {
  if (!osd || osd.frames.length === 0) return undefined;
  const idx = osdFrameIndexAt(osd.frames, videoTimeMs - offsetMs);
  return idx < 0 ? undefined : osd.frames[idx];
}

/**
 * Resolve the active SRT cue for a given video time.
 * @param srt Parsed SRT data (may be undefined if not loaded).
 * @param videoTimeMs Current video time in ms.
 * @param offsetMs Sync offset for the SRT track.
 */
export function activeSrtCue(
  srt: SrtData | undefined,
  videoTimeMs: number,
  offsetMs = 0,
): SrtCue | undefined {
  if (!srt || srt.cues.length === 0) return undefined;
  const idx = srtCueIndexAt(srt.cues, videoTimeMs - offsetMs);
  return idx < 0 ? undefined : srt.cues[idx];
}

/** Clamp a time (ms) into an inclusive range. */
export function clampMs(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Format a millisecond time as `M:SS.mmm` for compact UI display. */
export function formatMs(ms: number): string {
  const sign = ms < 0 ? '-' : '';
  const abs = Math.abs(ms);
  const totalSeconds = Math.floor(abs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = Math.floor(abs % 1000);
  return `${sign}${minutes}:${seconds.toString().padStart(2, '0')}.${millis
    .toString()
    .padStart(3, '0')}`;
}
