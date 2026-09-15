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

/**
 * Parse a time string into milliseconds. Accepts the `formatMs` output
 * (`M:SS.mmm`), longer `H:MM:SS.mmm`, and colon-less seconds (`83.4`). A value
 * with no colon is always read as seconds. Returns `null` when the string can't
 * be parsed.
 */
export function parseTimeMs(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;

  const sign = trimmed.startsWith('-') ? -1 : 1;
  const body = trimmed.replace(/^[-+]/, '');

  const parts = body.split(':');
  if (parts.length > 3) return null;

  let seconds = 0;
  for (const part of parts) {
    if (!/^\d*\.?\d*$/.test(part) || part === '' || part === '.') return null;
    const value = Number(part);
    if (!Number.isFinite(value)) return null;
    seconds = seconds * 60 + value;
  }

  return sign * Math.round(seconds * 1000);
}
