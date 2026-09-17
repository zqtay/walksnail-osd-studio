import { useEffect, useState } from 'react';

/**
 * A single OSD cell relocation: the source cell index (row*cols+col) plus a
 * displacement in whole grid cells (dRow, dCol). Lets individual glyphs be moved
 * to a different grid position without changing the recording.
 */
export type OsdMove = [cell: number, dRow: number, dCol: number];

export interface OverlaySettings {
  /** Show the OSD grid overlay. */
  osdEnabled: boolean;
  /** Show the SRT telemetry panel. */
  srtEnabled: boolean;
  /** OSD sync offset (ms) relative to the video. */
  osdOffsetMs: number;
  /** SRT sync offset (ms) relative to the video. */
  srtOffsetMs: number;
  /** OSD horizontal nudge (destination px). */
  osdOffsetX: number;
  /** OSD vertical nudge (destination px). */
  osdOffsetY: number;
  /** OSD extra scale multiplier. */
  osdScale: number;
  /** Hidden OSD grid cells (row*cols+col indices) to mask out. */
  osdMask: number[];
  /** Per-cell OSD relocations (source cell + grid-cell displacement). */
  osdMoves: OsdMove[];
  /** SRT panel field keys to display. */
  srtFields: string[];
  /** SRT panel anchor corner. */
  srtAnchor: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** SRT panel layout: all fields on one line, or one per line. */
  srtLayout: 'single' | 'multi';
  /** Show the dark background box behind the telemetry panel. */
  srtBackground: boolean;
  /** Telemetry panel size multiplier (scales the font). */
  srtScale: number;
  /** Telemetry panel horizontal nudge (destination px). */
  srtOffsetX: number;
  /** Telemetry panel vertical nudge (destination px). */
  srtOffsetY: number;
  /** Background color drawn behind the overlay when no video is loaded. */
  bgColor: string;
  /** Show the background color in place of the video (even when a video is loaded). */
  useBackground: boolean;
}

export const DEFAULT_SETTINGS: OverlaySettings = {
  osdEnabled: true,
  srtEnabled: true,
  osdOffsetMs: 0,
  srtOffsetMs: 0,
  osdOffsetX: 0,
  osdOffsetY: 0,
  osdScale: 1,
  osdMask: [],
  osdMoves: [],
  srtFields: ['Signal', 'Delay', 'Bitrate', 'SBat', 'Distance'],
  srtAnchor: 'bottom-left',
  srtLayout: 'single',
  srtBackground: true,
  srtScale: 1,
  srtOffsetX: 0,
  srtOffsetY: 0,
  bgColor: '#000000',
  useBackground: false,
};

const STORAGE_KEY = 'walksnail-osd-studio:settings';

/** Persist overlay settings to localStorage, tolerating quota/parse errors. */
export function useOverlaySettings(): [
  OverlaySettings,
  (patch: Partial<OverlaySettings>) => void,
] {
  const [settings, setSettings] = useState<OverlaySettings>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch {
      /* ignore corrupt storage */
    }
    return DEFAULT_SETTINGS;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* ignore quota errors */
    }
  }, [settings]);

  const update = (patch: Partial<OverlaySettings>) =>
    setSettings((prev) => ({ ...prev, ...patch }));

  return [settings, update];
}
