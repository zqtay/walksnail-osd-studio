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
  moveEditing: boolean;
  onToggleMove: () => void;
  onClearMove: () => void;
}

/** Sidebar panel for OSD overlay adjustments and masking. */
export function OsdPanel({
  settings,
  update,
  hasOsd,
  maskEditing,
  onToggleMask,
  onClearMask,
  moveEditing,
  onToggleMove,
  onClearMove,
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
      <div className="field">
        <span>Move cells</span>
        <div className="mask-controls">
          <button
            className={`btn ${moveEditing ? 'btn--primary' : ''}`}
            onClick={onToggleMove}
            disabled={!hasOsd}
          >
            {moveEditing ? 'Done' : 'Edit'}
          </button>
          <button
            className="btn"
            onClick={onClearMove}
            disabled={settings.osdMoves.length === 0}
          >
            Clear
          </button>
          <span className="mask-controls__count">
            {settings.osdMoves.length} moved
          </span>
        </div>

      </div>
      <div className="field">
        <span>Mask cells</span>
        <div className="mask-controls">
          <button
            className={`btn ${maskEditing ? 'btn--primary' : ''}`}
            onClick={onToggleMask}
            disabled={!hasOsd}
          >
            {maskEditing ? 'Done' : 'Edit'}
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
      </div>
      {maskEditing && (
        <p className="hint">
          Drag over the video to hide OSD cells; drag over hidden cells to reveal
          them.
        </p>
      )}
      {moveEditing && (
        <p className="hint">
          Drag a cell to another grid position to relocate its glyph; drop it back
          on its origin to reset.
        </p>
      )}
    </>
  );
}
