import { formatMs } from '../engine/clock';
import { RangeSlider } from './range-slider';

export interface ExportUiState {
  width: number;
  height: number;
  bitrateMbps: number;
  includeAudio: boolean;
}

interface ExportPanelProps {
  state: ExportUiState;
  onChange: (patch: Partial<ExportUiState>) => void;
  durationMs: number;
  trimStartMs: number;
  trimEndMs: number;
  onTrimChange: (startMs: number, endMs: number) => void;
  nativeWidth: number;
  nativeHeight: number;
  busy: boolean;
  progress: number;
  onExport: () => void;
  onCancel: () => void;
  disabled?: boolean;
  /** True when the high-quality Mediabunny path will be used. */
  highQuality?: boolean;
}

/** Sidebar panel for configuring and running the burned-in export. */
export function ExportPanel({
  state,
  onChange,
  durationMs,
  trimStartMs,
  trimEndMs,
  onTrimChange,
  nativeWidth,
  nativeHeight,
  busy,
  progress,
  onExport,
  onCancel,
  disabled,
  highQuality,
}: ExportPanelProps) {
  const rangeMs = Math.max(0, trimEndMs - trimStartMs);

  return (
    <div className="export">
      <label className="field">
        <span>
          Trim <em>{formatMs(trimStartMs)} → {formatMs(trimEndMs)} ({formatMs(rangeMs)})</em>
        </span>
        <RangeSlider
          min={0}
          max={durationMs}
          step={1}
          start={trimStartMs}
          end={trimEndMs}
          onChange={onTrimChange}
        />
      </label>

      <label className="field">
        <span>Resolution</span>
        <select
          value={`${state.width}x${state.height}`}
          onChange={(e) => {
            const [w, h] = e.target.value.split('x').map(Number);
            onChange({ width: w, height: h });
          }}
        >
          <option value={`${nativeWidth}x${nativeHeight}`}>
            Native ({nativeWidth}×{nativeHeight})
          </option>
          <option value="2560x1440">1440p (2560×1440)</option>
          <option value="1920x1080">1080p (1920×1080)</option>
          <option value="1280x720">720p (1280×720)</option>
        </select>
      </label>

      <label className="field">
        <span>
          Bitrate <em>{state.bitrateMbps} Mbps</em>
        </span>
        <input
          type="range"
          min={4}
          max={100}
          step={1}
          value={state.bitrateMbps}
          onChange={(e) => onChange({ bitrateMbps: Number(e.target.value) })}
        />
      </label>

      <label className="toggle">
        <input
          type="checkbox"
          checked={state.includeAudio}
          onChange={(e) => onChange({ includeAudio: e.target.checked })}
        />
        <span>Include audio</span>
      </label>

      {busy ? (
        <div className="export__progress">
          <div className="export__bar">
            <div className="export__fill" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <button className="btn" onClick={onCancel}>
            Cancel
          </button>
        </div>
      ) : (
        <button
          className="btn btn--primary export__go"
          onClick={onExport}
          disabled={disabled || rangeMs <= 0}
        >
          Export clip
        </button>
      )}

      <p className="hint">
        {highQuality
          ? 'Encodes an H.264 MP4 with Mediabunny — deterministic, glitch-free, with audio copied losslessly.'
          : 'Falls back to real-time capture; audio support varies by browser.'}
      </p>
    </div>
  );
}
