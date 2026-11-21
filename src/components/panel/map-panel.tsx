import { useEffect, useState } from 'react';
import { Slider } from './slider';
import type { OverlaySettings } from '../../state/settings';
import type { GpsTrack } from '../../lib/map/gps';
import { resolveHeading } from '../../lib/map/heading';
import { TILE_PROVIDERS, tileProviderFor, type TileProvider } from '../../lib/map/tiles';
import { loadLocalVersions, type WaybackRelease } from '../../lib/map/wayback';

interface MapPanelProps {
  settings: OverlaySettings;
  update: (patch: Partial<OverlaySettings>) => void;
  /** Whether an OSD file is loaded. */
  hasOsd: boolean;
  /** GPS track decoded from the OSD, if any. */
  gps?: GpsTrack;
}

const providersIn = (category: TileProvider['category']) =>
  Object.values(TILE_PROVIDERS).filter((p) => p.category === category);

type ImageryState =
  | { status: 'loading' }
  | { status: 'ready'; versions: WaybackRelease[] }
  | { status: 'error' };

/** Past satellite captures at a location (Esri Wayback), fetched on demand. */
function usePastImagery(lat: number, lon: number, enabled: boolean): ImageryState | undefined {
  const [state, setState] = useState<ImageryState>();
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    setState({ status: 'loading' });
    loadLocalVersions(lat, lon).then(
      (versions) => live && setState({ status: 'ready', versions }),
      () => live && setState({ status: 'error' }),
    );
    return () => {
      live = false;
    };
  }, [lat, lon, enabled]);
  return enabled ? state : undefined;
}

/** Sidebar panel for the GPS map overlay. */
export function MapPanel({ settings, update, hasOsd, gps }: MapPanelProps) {
  const isSatellite =
    settings.mapTiles !== 'none' && TILE_PROVIDERS[settings.mapTiles].category === 'satellite';
  const anchor = gps ? (gps.home ?? gps.points[0]) : undefined;
  const pastImagery = usePastImagery(anchor?.lat ?? 0, anchor?.lon ?? 0, !!anchor && isSatellite);

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

      <h3 className="panel__subhead">Map style</h3>
      <label className="field">
        <span>
          Map tiles
          {settings.mapTiles !== 'none' && <small className="field__note">needs internet</small>}
        </span>
        <select
          value={settings.mapTiles}
          onChange={(e) => update({ mapTiles: e.target.value as OverlaySettings['mapTiles'] })}
        >
          <optgroup label="Map">
            {providersIn('map').map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Satellite">
            {providersIn('satellite').map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </optgroup>
          <option value="none">None (offline)</option>
        </select>
      </label>
      {isSatellite && (
        <ImageryDatePicker settings={settings} update={update} state={pastImagery} />
      )}
      <Slider
        label="Opacity"
        suffix="%"
        min={0}
        max={100}
        step={1}
        value={Math.round(settings.mapOpacity * 100)}
        onChange={(v) => update({ mapOpacity: v / 100 })}
      />
      {settings.mapTiles !== 'none' && (
        <>
          <label className="toggle">
            <input
              type="checkbox"
              checked={settings.mapShowCredit}
              onChange={(e) => update({ mapShowCredit: e.target.checked })}
            />
            <span>Show tile credit</span>
          </label>
          {!settings.mapShowCredit && (
            <p className="hint">
              The tile providers require credit when you publish the video, e.g. in its
              description: {tileProviderFor(settings)?.attribution}
            </p>
          )}
        </>
      )}

      <h3 className="panel__subhead">View</h3>
      <label className="field">
        <span>Mode</span>
        <select
          value={settings.mapMode}
          onChange={(e) => update({ mapMode: e.target.value as OverlaySettings['mapMode'] })}
        >
          <option value="follow">Follow drone</option>
          <option value="overview">Whole trail</option>
        </select>
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.mapAdaptiveZoom}
          onChange={(e) => update({ mapAdaptiveZoom: e.target.checked })}
        />
        <span>Adaptive zoom</span>
      </label>
      {settings.mapAdaptiveZoom && (
        <p className="hint">
          {settings.mapMode === 'follow'
            ? 'Zooms out smoothly when needed to keep the home point in view.'
            : 'Fits the drone and home point, zooming smoothly as they move apart.'}
        </p>
      )}
      {(settings.mapMode === 'follow' || settings.mapAdaptiveZoom) && (
        <Slider
          label={settings.mapAdaptiveZoom ? 'Max zoom' : 'Zoom'}
          suffix=""
          min={12}
          max={20}
          step={0.25}
          value={settings.mapZoom}
          onChange={(v) => update({ mapZoom: v })}
        />
      )}

      <h3 className="panel__subhead">Overlay</h3>
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
      <label className="field">
        <span>Units</span>
        <select
          value={settings.mapUnits}
          onChange={(e) => update({ mapUnits: e.target.value as OverlaySettings['mapUnits'] })}
        >
          <option value="metric">Metric (m, km)</option>
          <option value="imperial">Imperial (ft, mi)</option>
        </select>
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.mapShowScale}
          onChange={(e) => update({ mapShowScale: e.target.checked })}
        />
        <span>Show scale bar</span>
      </label>

      <h3 className="panel__subhead">Trail</h3>
      <label className="field">
        <span>Color</span>
        <input
          type="color"
          value={settings.mapTrailColor}
          onChange={(e) => update({ mapTrailColor: e.target.value })}
        />
      </label>
      <Slider
        label="Smoothing"
        suffix="%"
        min={0}
        max={100}
        step={1}
        value={settings.mapSmoothing}
        onChange={(v) => update({ mapSmoothing: v })}
      />
      <Slider
        label="Length"
        suffix="s"
        min={0}
        max={300}
        step={1}
        value={settings.mapTrailSeconds}
        onChange={(v) => update({ mapTrailSeconds: v })}
        format={(v) => (v === 0 ? 'All' : `last ${v}s`)}
      />
      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.mapFutureTrail}
          onChange={(e) => update({ mapFutureTrail: e.target.checked })}
        />
        <span>Show upcoming path</span>
      </label>

      <h3 className="panel__subhead">Markers</h3>
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
      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.mapShowHome}
          onChange={(e) => update({ mapShowHome: e.target.checked })}
        />
        <span>Show home point</span>
      </label>
      <label className="toggle toggle--nested">
        <input
          type="checkbox"
          checked={settings.mapShowHomeDistance}
          disabled={!settings.mapShowHome}
          onChange={(e) => update({ mapShowHomeDistance: e.target.checked })}
        />
        <span>Show home distance</span>
      </label>
    </>
  );
}

interface ImageryDatePickerProps {
  settings: OverlaySettings;
  update: (patch: Partial<OverlaySettings>) => void;
  state?: ImageryState;
}

/** Choose the latest satellite imagery or a past capture of the flight area. */
function ImageryDatePicker({ settings, update, state }: ImageryDatePickerProps) {
  const versions = state?.status === 'ready' ? state.versions : [];
  // Keep a saved release selectable even if it isn't listed for this area.
  const options =
    settings.mapImagery && !versions.some((v) => v.id === settings.mapImagery)
      ? [{ id: settings.mapImagery, date: settings.mapImageryDate || 'Saved capture' }, ...versions]
      : versions;

  return (
    <>
      <label className="field">
        <span>Imagery date</span>
        <select
          value={settings.mapImagery}
          onChange={(e) => {
            const id = Number(e.target.value);
            const date = options.find((v) => v.id === id)?.date ?? '';
            update({ mapImagery: id, mapImageryDate: id ? date : '' });
          }}
        >
          <option value={0}>Latest</option>
          {options.map((v) => (
            <option key={v.id} value={v.id}>
              {v.date}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">
        {state?.status === 'loading' && 'Finding past imagery of this area…'}
        {state?.status === 'error' && 'Couldn\'t load past imagery dates.'}
        {state?.status === 'ready' &&
          (versions.length > 0
            ? `${versions.length} past captures of this area. Dates are Esri releases; the imagery may be older.`
            : 'No past imagery found for this area.')}
      </p>
    </>
  );
}
