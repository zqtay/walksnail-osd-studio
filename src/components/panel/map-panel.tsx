import { Slider } from './slider';
import type { OverlaySettings } from '../../state/settings';
import type { GpsTrack } from '../../lib/map/gps';
import { resolveHeading } from '../../lib/map/heading';

interface MapPanelProps {
  settings: OverlaySettings;
  update: (patch: Partial<OverlaySettings>) => void;
  /** Whether an OSD file is loaded. */
  hasOsd: boolean;
  /** GPS track decoded from the OSD, if any. */
  gps?: GpsTrack;
}

/** Sidebar panel for the GPS map overlay. */
export function MapPanel({ settings, update, hasOsd, gps }: MapPanelProps) {
  if (!hasOsd) {
    return <p className="hint">Load an .osd recorded with GPS coordinates on screen.</p>;
  }
  if (!gps) {
    return (
      <p className="hint">
        No GPS coordinates found in this OSD. Enable the GPS latitude and longitude
        elements in your flight controller's OSD to record them.
      </p>
    );
  }

  // Show the source actually in use: an unavailable preference falls back
  // (numeric -> compass -> trail) without overwriting the saved choice.
  const headingSource = resolveHeading(gps.headings, settings.mapHeading)?.source ?? 'trail';
  const missing = (key: 'numeric' | 'compass') => (gps.headings[key] ? '' : ' (not in OSD)');

  const durationS = Math.round(
    (gps.points[gps.points.length - 1].t - gps.points[0].t) / 1000,
  );

  return (
    <>
      <p className="hint">
        {gps.points.length} fixes over {durationS}s · {gps.source}
        {gps.homeSource === 'arming' ? ' · home set at arming' : ' · home = first fix'}
      </p>
      <label className="field">
        <span>Map tiles</span>
        <select
          value={settings.mapTiles}
          onChange={(e) => update({ mapTiles: e.target.value as OverlaySettings['mapTiles'] })}
        >
          <option value="map">Street map</option>
          <option value="satellite">Satellite</option>
          <option value="none">None (offline)</option>
        </select>
      </label>
      {settings.mapTiles !== 'none' && (
        <p className="hint">Map tiles need an internet connection.</p>
      )}
      <label className="field">
        <span>View</span>
        <select
          value={settings.mapMode}
          onChange={(e) => update({ mapMode: e.target.value as OverlaySettings['mapMode'] })}
        >
          <option value="follow">Follow drone</option>
          <option value="overview">Whole trail</option>
        </select>
      </label>
      <label className="field">
        <span>Shape</span>
        <select
          value={settings.mapShape}
          onChange={(e) => update({ mapShape: e.target.value as OverlaySettings['mapShape'] })}
        >
          <option value="rect">Rectangle</option>
          <option value="circle">Circle</option>
        </select>
      </label>
      <label className="field">
        <span>Arrow heading</span>
        <select
          value={headingSource}
          onChange={(e) =>
            update({ mapHeading: e.target.value as OverlaySettings['mapHeading'] })
          }
        >
          <option value="numeric" disabled={!gps.headings.numeric}>
            Numerical heading{missing('numeric')}
          </option>
          <option value="compass" disabled={!gps.headings.compass}>
            Compass{missing('compass')}
          </option>
          <option value="trail">None (infer by trail)</option>
        </select>
      </label>
      <Slider
        label="Size"
        suffix="%"
        min={8}
        max={90}
        step={1}
        value={Math.round(settings.mapSize * 100)}
        onChange={(v) => update({ mapSize: v / 100 })}
      />
      {settings.mapShape === 'rect' && (
        <Slider
          label="Aspect"
          suffix=":1"
          min={0.5}
          max={2.5}
          step={0.05}
          value={settings.mapAspect}
          onChange={(v) => update({ mapAspect: v })}
        />
      )}
      {settings.mapMode === 'follow' && (
        <Slider
          label="Zoom"
          suffix=""
          min={12}
          max={20}
          step={0.25}
          value={settings.mapZoom}
          onChange={(v) => update({ mapZoom: v })}
        />
      )}
      <Slider
        label="Trail smoothing"
        suffix="%"
        min={0}
        max={100}
        step={1}
        value={settings.mapSmoothing}
        onChange={(v) => update({ mapSmoothing: v })}
      />
      <Slider
        label="Trail length"
        suffix="s"
        min={0}
        max={300}
        step={1}
        value={settings.mapTrailSeconds}
        onChange={(v) => update({ mapTrailSeconds: v })}
        format={(v) => (v === 0 ? 'All' : `last ${v}s`)}
      />
      <Slider
        label="Map opacity"
        suffix="%"
        min={0}
        max={100}
        step={1}
        value={Math.round(settings.mapOpacity * 100)}
        onChange={(v) => update({ mapOpacity: v / 100 })}
      />
      <label className="field">
        <span>Trail color</span>
        <input
          type="color"
          value={settings.mapTrailColor}
          onChange={(e) => update({ mapTrailColor: e.target.value })}
        />
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.mapShowHome}
          onChange={(e) => update({ mapShowHome: e.target.checked })}
        />
        <span>Show home point</span>
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.mapFutureTrail}
          onChange={(e) => update({ mapFutureTrail: e.target.checked })}
        />
        <span>Show upcoming path</span>
      </label>
    </>
  );
}
