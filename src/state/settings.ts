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
  /** Show the GPS map overlay (when the OSD contains coordinates). */
  mapEnabled: boolean;
  /** Map tile source; 'none' draws the trail on a plain background (offline). */
  mapTiles: 'map' | 'dark' | 'topo' | 'satellite' | 'hybrid' | 'none';
  /** Esri Wayback release for satellite styles; 0 uses the latest imagery. */
  mapImagery: number;
  /** Publication date of `mapImagery` (for the credit line and the picker). */
  mapImageryDate: string;
  /** Keep the drone centered, or fit the whole trail. */
  mapMode: 'follow' | 'overview';
  /** Overlay outline. */
  mapShape: 'rect' | 'circle';
  /** Overlay left edge as a fraction of the output width. */
  mapX: number;
  /** Overlay top edge as a fraction of the output height. */
  mapY: number;
  /** Overlay height as a fraction of the output height. */
  mapSize: number;
  /** Overlay width / height (rect shape only). */
  mapAspect: number;
  /** Zoom level in follow mode (one tile at this zoom spans the overlay height). */
  mapZoom: number;
  /** Trail smoothing, 0..100 (%). */
  mapSmoothing: number;
  /** Opacity of the map background/tiles, 0..1. */
  mapOpacity: number;
  /** Show the home point. */
  mapShowHome: boolean;
  /** Label the home point with the drone's distance from it. */
  mapShowHomeDistance: boolean;
  /** Draw the not-yet-flown part of the trail faintly. */
  mapFutureTrail: boolean;
  /** Trail color. */
  mapTrailColor: string;
  /**
   * Drone arrow heading source: the OSD numerical heading, the OSD compass bar,
   * or inferred from the trail. Falls back when the OSD lacks the choice.
   */
  mapHeading: 'numeric' | 'compass' | 'trail';
  /** Show only the last N seconds of flown trail; 0 shows all of it. */
  mapTrailSeconds: number;
  /**
   * Continuously adjust zoom so the drone and home stay in view (`mapZoom`
   * becomes the maximum zoom).
   */
  mapAdaptiveZoom: boolean;
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
  mapEnabled: true,
  mapTiles: 'map',
  mapImagery: 0,
  mapImageryDate: '',
  mapMode: 'follow',
  mapShape: 'rect',
  mapX: 0.8,
  mapY: 0.6,
  mapSize: 0.32,
  mapAspect: 1,
  mapZoom: 18,
  mapSmoothing: 10,
  mapOpacity: 0.9,
  mapShowHome: true,
  mapShowHomeDistance: true,
  mapFutureTrail: true,
  mapTrailColor: '#ff4d4f',
  mapHeading: 'numeric',
  mapTrailSeconds: 0,
  mapAdaptiveZoom: false,
};

/** Map setting keys (everything the Map section's reset restores). */
export const MAP_SETTING_KEYS = [
  'mapTiles',
  'mapImagery',
  'mapImageryDate',
  'mapMode',
  'mapShape',
  'mapX',
  'mapY',
  'mapSize',
  'mapAspect',
  'mapZoom',
  'mapSmoothing',
  'mapOpacity',
  'mapShowHome',
  'mapShowHomeDistance',
  'mapFutureTrail',
  'mapTrailColor',
  'mapHeading',
  'mapTrailSeconds',
  'mapAdaptiveZoom',
] as const satisfies readonly (keyof OverlaySettings)[];

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
