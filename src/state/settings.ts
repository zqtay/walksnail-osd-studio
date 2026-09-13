import { useEffect, useState } from 'react';

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
  /** SRT panel field keys to display. */
  srtFields: string[];
  /** SRT panel anchor corner. */
  srtAnchor: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

export const DEFAULT_SETTINGS: OverlaySettings = {
  osdEnabled: true,
  srtEnabled: true,
  osdOffsetMs: 0,
  srtOffsetMs: 0,
  osdOffsetX: 0,
  osdOffsetY: 0,
  osdScale: 1,
  srtFields: ['Signal', 'Delay', 'Bitrate', 'SBat', 'Distance'],
  srtAnchor: 'bottom-left',
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
