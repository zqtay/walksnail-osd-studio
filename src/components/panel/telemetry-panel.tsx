import { Slider } from './slider';
import type { OverlaySettings } from '../../state/settings';

interface TelemetryPanelProps {
  settings: OverlaySettings;
  update: (patch: Partial<OverlaySettings>) => void;
  /** Telemetry field keys available in the loaded SRT. */
  availableFields: string[];
}

/** Sidebar panel for telemetry overlay position, styling and field selection. */
export function TelemetryPanel({
  settings,
  update,
  availableFields,
}: TelemetryPanelProps) {
  return (
    <>
      <Slider
        label="Sync offset"
        suffix="ms"
        min={-2000}
        max={2000}
        step={10}
        value={settings.srtOffsetMs}
        onChange={(v) => update({ srtOffsetMs: v })}
      />
      <label className="field">
        <span>Anchor</span>
        <select
          value={settings.srtAnchor}
          onChange={(e) =>
            update({ srtAnchor: e.target.value as typeof settings.srtAnchor })
          }
        >
          <option value="top-left">Top left</option>
          <option value="top-right">Top right</option>
          <option value="bottom-left">Bottom left</option>
          <option value="bottom-right">Bottom right</option>
        </select>
      </label>
      <label className="field">
        <span>Layout</span>
        <select
          value={settings.srtLayout}
          onChange={(e) =>
            update({ srtLayout: e.target.value as typeof settings.srtLayout })
          }
        >
          <option value="single">Single line</option>
          <option value="multi">Multiple lines</option>
        </select>
      </label>
      <label className="toggle">
        <input
          type="checkbox"
          checked={settings.srtBackground}
          onChange={(e) => update({ srtBackground: e.target.checked })}
        />
        <span>Background box</span>
      </label>
      <Slider
        label="Size"
        suffix="×"
        min={0.5}
        max={3}
        step={0.05}
        value={settings.srtScale}
        onChange={(v) => update({ srtScale: v })}
      />
      <Slider
        label="Nudge X"
        suffix="px"
        min={-400}
        max={400}
        step={1}
        value={settings.srtOffsetX}
        onChange={(v) => update({ srtOffsetX: v })}
      />
      <Slider
        label="Nudge Y"
        suffix="px"
        min={-400}
        max={400}
        step={1}
        value={settings.srtOffsetY}
        onChange={(v) => update({ srtOffsetY: v })}
      />
      {availableFields.length > 0 && (
        <div className="fields">
          {availableFields.map((f) => (
            <label key={f} className="chip">
              <input
                type="checkbox"
                checked={settings.srtFields.includes(f)}
                onChange={(e) => {
                  const set = new Set(settings.srtFields);
                  if (e.target.checked) set.add(f);
                  else set.delete(f);
                  update({
                    srtFields: availableFields.filter((k) => set.has(k)),
                  });
                }}
              />
              {f}
            </label>
          ))}
        </div>
      )}
    </>
  );
}
