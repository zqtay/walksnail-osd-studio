import { Slider } from './slider';
import type { OverlaySettings } from '../../state/settings';

interface OsdPanelProps {
  settings: OverlaySettings;
  update: (patch: Partial<OverlaySettings>) => void;
  /** Whether OSD data is loaded (enables the mask editor). */
  hasOsd: boolean;
  maskEditing: boolean;
  onToggleMask: () => void;
  onClearMask: () => void;
}

/** Sidebar panel for OSD overlay adjustments and masking. */
export function OsdPanel({
  settings,
  update,
  hasOsd,
  maskEditing,
  onToggleMask,
  onClearMask,
}: OsdPanelProps) {
  return (
    <>
      <Slider
        label="Sync offset"
        suffix="ms"
        min={-2000}
        max={2000}
        step={10}
        value={settings.osdOffsetMs}
        onChange={(v) => update({ osdOffsetMs: v })}
      />
      <Slider
        label="Scale"
        suffix="×"
        min={0.5}
        max={1.5}
        step={0.01}
        value={settings.osdScale}
        onChange={(v) => update({ osdScale: v })}
      />
      <Slider
        label="Nudge X"
        suffix="px"
        min={-200}
        max={200}
        step={1}
        value={settings.osdOffsetX}
        onChange={(v) => update({ osdOffsetX: v })}
      />
      <Slider
        label="Nudge Y"
        suffix="px"
        min={-200}
        max={200}
        step={1}
        value={settings.osdOffsetY}
        onChange={(v) => update({ osdOffsetY: v })}
      />
      <div className="mask-controls">
        <button
          className={`btn ${maskEditing ? 'btn--primary' : ''}`}
          onClick={onToggleMask}
          disabled={!hasOsd}
        >
          {maskEditing ? 'Done masking' : 'Edit mask'}
        </button>
        <button
          className="btn"
          onClick={onClearMask}
          disabled={settings.osdMask.length === 0}
        >
          Clear
        </button>
        <span className="mask-controls__count">
          {settings.osdMask.length} hidden
        </span>
      </div>
      {maskEditing && (
        <p className="hint">
          Drag over the video to hide OSD cells; drag over hidden cells to reveal
          them.
        </p>
      )}
    </>
  );
}
