import type { OsdData } from '../parsers/osd';
import type { SrtData } from '../parsers/srt';
import type { FontAtlas } from '../parsers/font';
import type { GpsTrack } from '../map/gps';
import type { TileCache } from '../map/tiles';
import { renderMap } from '../map/map-renderer';
import { activeOsdFrame, activeSrtCue } from './clock';
import { renderOsdFrame, renderSrtPanel } from './renderer';
import type { OverlaySettings } from '../../state/settings';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface OverlaySources {
  osd?: OsdData;
  srt?: SrtData;
  font?: FontAtlas;
  /** GPS track decoded from the OSD (drives the map overlay). */
  gps?: GpsTrack;
  /** Map tile cache; without it the map draws on a plain background. */
  tiles?: TileCache;
}

/**
 * Draw the OSD grid, SRT telemetry panel and GPS map for a given time onto a 2D context.
 * Shared by the live preview and the export pipeline so both produce identical
 * pixels. Does not clear the context; callers decide whether to clear or draw
 * over the video frame.
 */
export function drawOverlay(
  ctx: Ctx2D,
  sources: OverlaySources,
  settings: OverlaySettings,
  timeMs: number,
  width: number,
  height: number,
): void {
  const { osd, srt, font, gps, tiles } = sources;

  if (settings.osdEnabled && osd && font) {
    const frame = activeOsdFrame(osd, timeMs, settings.osdOffsetMs);
    if (frame) {
      const moves =
        settings.osdMoves.length > 0
          ? new Map(settings.osdMoves.map(([cell, dr, dc]) => [cell, { dr, dc }]))
          : undefined;
      renderOsdFrame(ctx, frame, osd.header.cols, osd.header.rows, font, width, height, {
        offsetX: settings.osdOffsetX,
        offsetY: settings.osdOffsetY,
        scale: settings.osdScale,
        mask: settings.osdMask.length > 0 ? new Set(settings.osdMask) : undefined,
        moves,
      });
    }
  }

  if (settings.srtEnabled && srt) {
    const cue = activeSrtCue(srt, timeMs, settings.srtOffsetMs);
    if (cue) {
      renderSrtPanel(ctx, cue, width, height, {
        fields: settings.srtFields,
        anchor: settings.srtAnchor,
        layout: settings.srtLayout,
        backgroundOpacity: settings.srtBackground ? undefined : 0,
        fontSize: Math.round(height * 0.022 * settings.srtScale),
        offsetX: settings.srtOffsetX,
        offsetY: settings.srtOffsetY,
      });
    }
  }

  // The GPS track comes from the OSD, so it follows the OSD sync offset.
  if (settings.mapEnabled && gps) {
    renderMap(ctx, gps, tiles, settings, timeMs - settings.osdOffsetMs, width, height);
  }
}
